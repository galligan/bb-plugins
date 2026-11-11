import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { setupTriggers, triggerHostOptions } from "./trigger-fixtures.ts";
import { parseMetadata } from "./verdict-metadata.ts";
const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
async function setup(fetcher?: typeof fetch) {
  const controls = triggerHostOptions(thread);
  return setupTriggers(
    createFakePluginHost(controls.options),
    controls,
    fetcher,
  );
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check());
}

test("thread advancement without a delivered observer still suppresses a completed stale verdict", async () => {
  let hold = false;
  let release = () => {};
  const h = await setup(async () => {
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return Response.json({
      model: "fixture",
      answers: { q: { type: "noul", noul: 0.9 } },
    });
  });
  try {
    h.enable();
    hold = true;
    const pending = h.engine.idle(h.idle());
    await until(() => h.bodies.length === 1);
    h.threads.set("thread", { ...h.current("thread"), updatedAt: 1001 });
    release();
    await pending;
    const attempt = h.repository.triggerAttempts.list({}).attempts[0]!;
    assert.equal(attempt.publication, "stale");
    assert.equal(attempt.code, "publication_stale");
    assert.equal(h.repository.getRun(attempt.runId)?.complete, true);
    assert.equal(h.writes(), 0);
  } finally {
    release();
    await h.harness.lifecycle.dispose();
  }
});

test("late metadata completion after disable is cleared, while authoritative keyed reads hide it immediately", async () => {
  const h = await setup();
  let release = () => {};
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let active = 0;
  let maximum = 0;
  try {
    const original = h.options.sdk.threads.updatePluginMetadata;
    h.harness.sdk.stub("threads.updatePluginMetadata", async (args) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (++calls === 1) {
          entered();
          await held;
        }
        return await original(args);
      } finally {
        active--;
      }
    });
    h.enable();
    const pending = h.engine.idle(h.idle());
    await started;
    h.triggers.enable("binding", false);
    await pending;
    assert.equal(
      (await h.api.verdicts.keyed({ threadIds: ["thread"] })).threads[0]
        ?.summaries.length,
      0,
    );
    assert.equal(calls, 1);
    assert.equal(
      h.repository.triggerAttempts.list({}).attempts[0]?.publication,
      "stale",
    );
    release();
    await until(
      () =>
        h.metadata.has("thread") &&
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(maximum, 1);
    assert.ok(calls >= 2);
    assert.equal(
      h.repository.triggerAttempts.list({}).attempts[0]?.publication,
      "cleared",
    );
    assert.equal(h.repository.publications.forThread("thread").length, 0);
  } finally {
    release();
    await h.harness.lifecycle.dispose();
  }
});

test("a coalesced sequence notification is compared with the admitted snapshot, including before snapshot completion", async () => {
  for (const sequence of [10, 11]) {
    const h = await setup();
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    try {
      h.harness.sdk.stub(
        "threads.get",
        async (args: Parameters<typeof h.options.sdk.threads.get>[0]) => {
          if (first) {
            first = false;
            entered();
            await held;
          }
          return h.current(args.threadId);
        },
      );
      h.enable();
      const pending = h.engine.idle(h.idle());
      await started;
      h.engine.observe("thread", sequence);
      release();
      await pending;
      assert.equal(h.bodies.length, sequence === 10 ? 1 : 0);
      assert.equal(h.writes(), sequence === 10 ? 1 : 0);
      assert.equal(h.repository.triggerAttempts.list({}).attempts.length, 1);
    } finally {
      release();
      await h.harness.lifecycle.dispose();
    }
  }
});
