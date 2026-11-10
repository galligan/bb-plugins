import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  fixtureHostOptions,
  setupRunner,
  question,
} from "./runner-fixtures.ts";
import { PersistenceError } from "./storage.ts";
const input = {
  state: { text: "PRIVATE_SYNTHETIC_STATE" },
  questions: question,
  model: "private",
};
async function setup(fetcher?: typeof fetch) {
  return setupRunner(createFakePluginHost(fixtureHostOptions), fetcher);
}
const count = (h: Awaited<ReturnType<typeof setup>>) =>
  (
    h.bb.storage
      .database()
      .prepare("SELECT COUNT(*) AS n FROM cache")
      .get() as { n: number }
  ).n;

test("outages, malformed responses, aborts and in-flight invalidation never populate cache", async () => {
  for (const kind of ["http", "invalid", "abort", "rotate"] as const) {
    let h: Awaited<ReturnType<typeof setup>>;
    const caller = new AbortController();
    h = await setup(async () => {
      if (kind === "rotate")
        await h.harness.behavior.setSettings({ typesafeApiKey: "dummy-next" });
      if (kind === "abort") caller.abort();
      return kind === "http"
        ? new Response("dummy-private-error", { status: 503 })
        : Response.json({ model: "fixture", answers: {} });
    });
    try {
      for (let i = 0; i < 2; i++) {
        const result = await h.api.asks.ask(input, caller.signal);
        assert.equal(result.complete, false);
      }
      assert.equal(count(h), 0);
      assert.equal(h.bodies.length, kind === "abort" ? 1 : 2);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("corrupt cache and transaction failures fail closed without a paid fallback or logged success", async () => {
  const h = await setup();
  try {
    await h.api.asks.ask(input);
    const db = h.bb.storage.database();
    db.prepare("UPDATE cache SET response_json = ?").run(
      "dummy-private-corruption",
    );
    await assert.rejects(h.api.asks.ask(input), PersistenceError);
    assert.equal(h.bodies.length, 1);
    assert.equal(h.repository.listRuns().length, 1);
    db.exec(
      "DELETE FROM cache; CREATE TRIGGER fail_cache BEFORE INSERT ON cache BEGIN SELECT RAISE(ABORT, 'dummy-private-disk-error'); END;",
    );
    await assert.rejects(h.api.asks.ask(input), PersistenceError);
    assert.equal(h.bodies.length, 2);
    assert.equal(h.repository.listRuns().length, 1);
    assert.equal(count(h), 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("pre-abort/expired budgets never read a warm cache, and queued policy revocation suppresses a hit", async (t) => {
  const h = await setup();
  try {
    await h.api.asks.ask(input);
    const get = h.repository.cache.get.bind(h.repository.cache);
    let reads = 0;
    t.mock.method(
      h.repository.cache,
      "get",
      (...args: Parameters<typeof get>) => {
        reads++;
        return get(...args);
      },
    );
    const controller = new AbortController();
    controller.abort();
    const aborted = await h.api.asks.ask(input, controller.signal);
    assert.equal(aborted.complete, false);
    const expired = await h.api.inference.ask({
      state: input.state,
      questions: input.questions,
      selection: { override: "private", sensitive: true },
      deadlineAt: performance.now() - 1,
    });
    assert.equal(
      expired.result.status === "unavailable" && expired.result.reason,
      "budget",
    );
    assert.equal(reads, 0);
    t.mock.method(
      h.repository.cache,
      "get",
      (...args: Parameters<typeof get>) => {
        const cached = get(...args);
        queueMicrotask(() =>
          h.api.models.save({
            ...h.api.models.list().find((m) => m.id === "private")!,
            allowPrivate: false,
          }),
        );
        return cached;
      },
    );
    const revoked = await h.api.asks.ask(input);
    assert.equal(revoked.complete, false);
    assert.equal(
      revoked.steps.main?.status === "unavailable" && revoked.steps.main.reason,
      "cancelled",
    );
    assert.equal(h.bodies.length, 1);
    assert.equal(count(h), 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
