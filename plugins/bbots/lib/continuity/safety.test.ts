import assert from "node:assert/strict";
import { test } from "node:test";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createSourceStore } from "../tasks/source-store.ts";
import { fixture, attribution, context } from "./fixture.test.ts";

test("forgetting during task availability lookup filters references before preparation output; configured authority remains", async (t) => {
  const f = fixture(t),
    note = f.note().entry;
  createSourceStore(f.store, () => {}).write(
    { botId: f.bot.botId, expectedRevision: 0, ...attribution },
    { kind: "tasks", phase: "ready", boardId: "board_fixture" },
  );
  const prepared = await f.continuity.prepare(f.request());
  f.harness.sdk.stub("plugins.callRpc", () => {
    f.memory.forget(f.bot.botId, note.id, 1, attribution.author);
    throw new Error("Tasks temporarily unavailable");
  });
  const shown = await f.continuity.show(f.bot.botId, prepared.id);
  assert.deepEqual(shown.knowledge, []);
  assert.equal(shown.suppressedReferenceCount, 1);
  assert.equal(shown.currentTaskSource.availability, "unavailable");
  assert.deepEqual(f.tasks.read(f.bot.botId).source, {
    kind: "tasks",
    phase: "ready",
    boardId: "board_fixture",
  });
});

test("archived native sources, wrong-thread events and cancellation during native observation commit nothing", async (t) => {
  for (const scenario of ["archived", "events", "cancel"])
    await t.test(scenario, async (t) => {
      const f = fixture(t),
        controller = new AbortController();
      if (scenario === "archived")
        f.harness.sdk.stub("threads.get", ({ threadId }) =>
          makeThreadResponse({ id: threadId, archivedAt: Date.now() }),
        );
      if (scenario === "events")
        f.harness.sdk.stub("threads.events.list", () => [
          {
            id: "event_foreign",
            threadId: "thr_other",
            scope: { kind: "thread" },
            seq: 1,
            createdAt: Date.now(),
            type: "system/thread/interrupted",
            data: { reason: "manual-stop" },
          },
        ]);
      if (scenario === "cancel")
        f.harness.sdk.stub("threads.context", () => {
          controller.abort();
          return context();
        });
      await assert.rejects(
        f.continuity.prepare(f.request(), controller.signal),
      );
      assert.deepEqual(f.checkpoints.list(f.bot.botId).items, []);
      assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
      assert.equal(
        f.harness.inspection.sdk.callsTo("threads.compact").length,
        0,
      );
      assert.equal(
        f.harness.inspection.sdk.callsTo("threads.clearContext").length,
        0,
      );
    });
});
