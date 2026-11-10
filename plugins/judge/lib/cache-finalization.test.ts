import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  fixtureHostOptions,
  setupRunner,
  question,
} from "./runner-fixtures.ts";
import type { ModelSelection } from "./privacy.ts";
const input = { state: null, questions: question, model: "private" };
for (const kind of ["cancelled", "budget"] as const) {
  test(`${kind} during final model validation cannot warm cache or claim a completed run`, async (t) => {
    const h = await setupRunner(createFakePluginHost(fixtureHostOptions));
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const caller = new AbortController();
    let callbackComplete = false;
    let barrierUsed = false;
    let offset = 0;
    try {
      const using = h.api.models.usingModel.bind(h.api.models);
      type Prepared = Parameters<Parameters<typeof using>[1]>[0];
      // Synchronize the semantic post-callback check, independent of check count.
      t.mock.method(
        h.api.models,
        "usingModel",
        <T>(
          selection: ModelSelection,
          operation: (prepared: Prepared) => Promise<T>,
        ) =>
          using(selection, async (prepared) => {
            const value = await operation(prepared);
            callbackComplete = true;
            return value;
          }),
      );
      const current = h.api.models.isCurrent.bind(h.api.models);
      t.mock.method(
        h.api.models,
        "isCurrent",
        async (...args: Parameters<typeof current>) => {
          const value = await current(...args);
          if (callbackComplete && !barrierUsed) {
            barrierUsed = true;
            enter();
            await held;
          }
          return value;
        },
      );
      const now = performance.now.bind(performance);
      t.mock.method(performance, "now", () => now() + offset);
      const pending = h.api.asks.ask(input, caller.signal);
      await entered;
      if (kind === "cancelled") caller.abort();
      else {
        offset = 6000;
        release();
      }
      const result = await pending;
      assert.equal(result.complete, false);
      assert.equal(
        result.steps.main?.status === "unavailable" && result.steps.main.reason,
        kind,
      );
      release();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        (
          h.bb.storage
            .database()
            .prepare("SELECT COUNT(*) AS n FROM cache")
            .get() as { n: number }
        ).n,
        0,
      );
      assert.deepEqual(h.repository.getRun(result.runId), result);
      t.mock.restoreAll();
      const next = await h.api.asks.ask(input);
      assert.equal(
        next.steps.main?.status === "ran" && next.steps.main.cacheHit,
        false,
      );
      assert.equal(h.bodies.length, 2);
    } finally {
      caller.abort();
      release();
      await h.harness.lifecycle.dispose();
    }
  });
}

for (const kind of ["cancelled", "budget"] as const) {
  test(`${kind} during cache insertion rolls back before commit and preserves typed failure`, async (t) => {
    const h = await setupRunner(createFakePluginHost(fixtureHostOptions));
    const caller = new AbortController();
    let offset = 0;
    try {
      const now = performance.now.bind(performance);
      t.mock.method(performance, "now", () => now() + offset);
      const db = h.bb.storage.database();
      db.function("expire_cache_fixture", () => {
        if (kind === "cancelled") caller.abort();
        else offset = 6000;
        return 0;
      });
      db.exec(
        "CREATE TRIGGER expire_cache BEFORE INSERT ON cache BEGIN SELECT expire_cache_fixture(); END;",
      );
      const result = await h.api.asks.ask(input, caller.signal);
      assert.equal(result.complete, false);
      assert.equal(
        result.steps.main?.status === "unavailable" && result.steps.main.reason,
        kind,
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS n FROM cache").get() as { n: number })
          .n,
        0,
      );
      assert.deepEqual(h.repository.getRun(result.runId), result);
      db.exec("DROP TRIGGER expire_cache");
      t.mock.restoreAll();
      const next = await h.api.asks.ask(input);
      assert.equal(
        next.steps.main?.status === "ran" && next.steps.main.cacheHit,
        false,
      );
      assert.equal(h.bodies.length, 2);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
}
