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
async function setup() {
  const controls = triggerHostOptions(thread);
  return setupTriggers(createFakePluginHost(controls.options), controls);
}

test("trigger CLI/RPC share disabled saves, explicit enable, strict arguments, bounded pages and help", async () => {
  const h = await setup();
  try {
    for (const command of [
      ["triggers"],
      ["triggers", "list"],
      ["triggers", "show"],
      ["triggers", "add"],
      ["triggers", "save"],
      ["triggers", "enable"],
      ["triggers", "disable"],
      ["triggers", "remove"],
      ["triggers", "log"],
    ])
      assert.equal(
        (await h.harness.behavior.runCli([...command, "--help"])).exitCode,
        0,
      );
    const added = await h.harness.behavior.runCli([
      "triggers",
      "add",
      "b",
      "--set",
      "event-set",
      "--event",
      "thread.idle",
      "--projects",
      '["project"]',
      "--badges",
      '{"accepted":"Synthetic"}',
      "--json",
    ]);
    assert.equal(added.exitCode, 0);
    assert.equal(JSON.parse(added.stdout).enabled, false);
    await h.harness.behavior.callRpc("triggers.enable", {
      id: "b",
      enabled: true,
    });
    assert.equal(h.triggers.get("b")?.enabled, true);
    const edited = await h.harness.behavior.callRpc("triggers.save", {
      id: "b",
      setId: "event-set",
      event: "thread.idle",
    });
    assert.equal((edited as { enabled: boolean }).enabled, false);
    assert.equal(
      (await h.harness.behavior.runCli(["triggers", "enable", "b", "--json"]))
        .exitCode,
      0,
    );
    assert.equal(
      (await h.harness.behavior.runCli(["triggers", "disable", "b", "--json"]))
        .exitCode,
      0,
    );
    assert.equal(
      (await h.harness.behavior.runCli(["triggers", "log", "--json"])).exitCode,
      0,
    );
    for (const args of [
      ["triggers", "add", "bad", "--json"],
      [
        "triggers",
        "add",
        "bad",
        "--set",
        "event-set",
        "--event",
        "message.dispatch",
        "--json",
      ],
      ["triggers", "enable", "b", "--not-private", "--json"],
      ["triggers", "list", "--limit", "21", "--json"],
      [
        "triggers",
        "add",
        "bad",
        "--set",
        "event-set",
        "--event",
        "thread.idle",
        "--badges",
        "not-json",
        "--json",
      ],
    ]) {
      const bad = await h.harness.behavior.runCli(args);
      assert.equal(bad.exitCode, 1);
      assert.equal(JSON.parse(bad.stdout).ok, false);
    }
    for (const bad of [
      { id: "bad", setId: "event-set", event: "thread.idle", enabled: true },
      {
        id: "bad",
        setId: "event-set",
        event: "thread.idle",
        actions: { send: "x" },
      },
      {
        id: "bad",
        setId: "event-set",
        event: "thread.idle",
        badges: { missing: "Unknown" },
      },
    ])
      await assert.rejects(h.harness.behavior.callRpc("triggers.save", bad));
    assert.equal(h.bodies.length, 0);
    assert.equal(h.writes(), 0);
    assert.ok(await h.api.calibration.get("event-set"));
    const page = (await h.harness.behavior.callRpc("triggers.list", {
      limit: 1,
    })) as { next: null };
    assert.equal(page.next, null);
    await h.harness.behavior.callRpc("triggers.remove", { id: "b" });
    assert.equal(
      await h.harness.behavior.callRpc("triggers.show", { id: "b" }),
      null,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
