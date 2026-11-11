import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { setupTriggers, triggerHostOptions } from "./trigger-fixtures.ts";
import { displayThread, displayBadges, registerUiUpdates } from "./ui.ts";
import { threadDisplaySchema } from "./ui-contract.ts";
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
async function setup() {
  const controls = triggerHostOptions(thread);
  return setupTriggers(createFakePluginHost(controls.options), controls);
}
test("UI thread DTO shows current status and actual model identity without source state or answers", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const view = threadDisplaySchema.parse(
      await h.harness.behavior.callRpc("ui.thread", { threadId: "thread" }),
    );
    assert.equal(view.latest?.status, "current");
    assert.equal(view.latest?.models[0]?.id, "private");
    assert.equal(view.current.badges[0]?.label, "Synthetic verdict");
    for (const forbidden of [
      "answers",
      "provenance",
      "SYNTHETIC_CURRENT_REPLY",
      "dummy-runner-secret",
    ])
      assert.ok(!JSON.stringify(view).includes(forbidden));
    h.triggers.enable("binding", false);
    const retired = await displayThread(h.api, "thread");
    assert.equal(retired.current.badges.length, 0);
    assert.equal(retired.latest?.status, "recorded");
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("UI latest unavailable status is retained even when no badge can publish; empty threads have explicit absence", async () => {
  const h = await setup();
  try {
    const model = h.repository.getModel("private")!;
    h.api.models.save({ ...model, allowPrivate: false });
    const run = await h.api.runner.run({ id: "event-set", threadId: "thread" });
    assert.equal(run.complete, false);
    const view = await displayThread(h.api, "thread");
    assert.equal(view.latest?.status, "unavailable");
    assert.ok(view.latest?.code);
    assert.equal(view.current.badges.length, 0);
    assert.equal((await displayThread(h.api, "empty")).latest, null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("UI badge RPC validates bounded keyed rows and rejects forged metadata", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    assert.equal(
      (await displayBadges(h.api, { threadIds: ["thread"] })).threads[0]?.badges
        .length,
      1,
    );
    h.metadata.set("thread", {
      verdicts: { version: 1, summaries: [{ answers: "PRIVATE" }] },
    });
    const value = await displayBadges(h.api, { threadIds: ["thread"] });
    assert.equal(value.threads[0]?.badges.length, 0);
    assert.equal(value.threads[0]?.publicationFailure, "invalid_metadata");
    assert.ok(!JSON.stringify(value).includes("PRIVATE"));
    await assert.rejects(() =>
      displayBadges(h.api, {
        threadIds: Array.from({ length: 201 }, (_, i) => `t${i}`),
      }),
    );
    await assert.rejects(() =>
      displayBadges(h.api, { threadIds: ["thread", "thread"] }),
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(() =>
      displayBadges(h.api, { threadIds: ["thread"] }, abort.signal),
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("UI policy reads and coalesced notifications do no inference; sidebar toggle preserves calibration", async () => {
  const h = await setup();
  try {
    registerUiUpdates(h.bb, h.api);
    const before = h.api.models.configurationGeneration();
    const acceptance = await h.api.calibration.get("event-set");
    const bodies = h.bodies.length;
    await h.harness.behavior.setSettings({ showSidebarBadges: true });
    assert.equal(h.api.models.configurationGeneration(), before);
    assert.deepEqual(await h.api.calibration.get("event-set"), acceptance);
    assert.deepEqual(
      await h.harness.behavior.callRpc("projects.get", {
        projectId: "project",
      }),
      { projectId: "project", enabled: true },
    );
    h.api.sets.project("project", false);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.deepEqual(
      await h.harness.behavior.callRpc("projects.get", {
        projectId: "project",
      }),
      { projectId: "project", enabled: false },
    );
    assert.ok(
      h.harness.inspection.realtimeSignals.some(
        (entry) => entry.channel === "changed",
      ),
    );
    assert.ok(
      h.harness.inspection.realtimeSignals.every(
        (entry) => !JSON.stringify(entry.payload).includes("answers"),
      ),
    );
    assert.equal(h.bodies.length, bodies);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
