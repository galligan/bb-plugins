import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { setupTriggers, triggerHostOptions } from "./trigger-fixtures.ts";
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

import judge from "../server.ts";
import { registerTriggerEvents } from "./trigger-registration.ts";
import { parseMetadata } from "./verdict-metadata.ts";
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check());
}

test("native event registration separates bindings from stale-state observers and clears on sequence advance", async () => {
  const h = await setup();
  try {
    registerTriggerEvents(h.bb, h.api);
    h.enable();
    assert.equal(
      (await h.harness.behavior.emitThreadEvent("thread.idle", h.idle())).errors
        .length,
      0,
    );
    assert.equal(h.bodies.length, 1);
    assert.equal(
      parseMetadata(h.metadata.get("thread")).verdicts.summaries.length,
      1,
    );
    const writes = h.writes();
    await h.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: h.current("thread"),
      sequence: 10,
    });
    assert.equal(h.writes(), writes);
    await h.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: h.current("thread"),
      sequence: 11,
    });
    assert.equal(
      (await h.api.verdicts.keyed({ threadIds: ["thread"] })).threads[0]
        ?.summaries.length,
      0,
    );
    await until(
      () =>
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(h.bodies.length, 1);
    await h.harness.behavior.emitThreadEvent("thread.active", {
      thread: { ...h.current("thread"), status: "active" },
    });
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("fake-host reload aborts an active event request and retains a truthful run while retiring calibration", async (t) => {
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
  let lifecycle = h.harness.lifecycle;
  try {
    registerTriggerEvents(h.bb, h.api);
    h.enable();
    hold = true;
    const pending = h.harness.behavior.emitThreadEvent("thread.idle", h.idle());
    await until(() => h.bodies.length === 1);
    let newNetwork = 0;
    t.mock.method(globalThis, "fetch", async () => {
      newNetwork++;
      throw new Error("live request forbidden");
    });
    const fresh = await lifecycle.reload(judge);
    lifecycle = fresh.harness.lifecycle;
    assert.equal((await pending).errors.length, 0);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    const log = (await fresh.harness.behavior.callRpc("triggers.log", {})) as {
      attempts: { runId: string }[];
    };
    assert.equal(log.attempts.length, 1);
    const run = (await fresh.harness.behavior.callRpc("runs.get", {
      id: log.attempts[0]!.runId,
    })) as { complete: boolean };
    assert.equal(run.complete, false);
    assert.equal(
      await fresh.harness.behavior.callRpc("calibration.get", {
        id: "event-set",
      }),
      null,
    );
    assert.equal(newNetwork, 0);
    assert.equal(h.writes(), 0);
  } finally {
    release();
    await lifecycle.dispose();
  }
});
