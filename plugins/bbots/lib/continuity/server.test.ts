import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { context } from "./fixture.test.ts";

test("real continuation CLI persists preparation through reload, checks caller/cancellation and invokes only native reads", async (t) => {
  let current = createFakePluginHost({ pluginId: "bbots" });
  plugin(current.bb);
  t.after(() => current.harness.lifecycle.dispose());
  const store = openSetup(current.bb.storage);
  function bot(name: string, threadId: string) {
    const bot = store.plan({
      requestId: randomUUID(),
      name,
      hostId: "host_fixture",
      associations: { mode: "none" },
    });
    store.conversations.bindInitialThread(bot.conversationId, threadId);
    return bot;
  }
  const bob = bot("Bob", "thr_main");
  bot("Alice", "thr_other");
  current.harness.sdk.stub("threads.get", ({ threadId }) =>
    makeThreadResponse({ id: threadId, status: "idle" }),
  );
  current.harness.sdk.stub("threads.context", () => context());
  current.harness.sdk.stub("threads.events.list", () => []);
  current.harness.sdk.stub("threads.queuedMessages.list", () => []);
  const run = (args: string[], threadId = "thr_main", signal?: AbortSignal) =>
    current.harness.behavior.runCli(args, { threadId, signal });
  const requestId = randomUUID();
  const args = [
    "continuity",
    "prepare",
    bob.botId,
    "--conversation",
    bob.conversationId,
    "--request-id",
    requestId,
    "--author",
    "fixture-user",
    "--reason",
    "Prepare in authorized turn",
    "--json",
  ];
  const controller = new AbortController();
  controller.abort();
  assert.equal((await run(args, "thr_main", controller.signal)).exitCode, 1);
  assert.equal((await run(args, "thr_other")).exitCode, 1);
  assert.equal(current.harness.inspection.sdk.calls.length, 0);
  const prepared = await run(args);
  assert.equal(prepared.exitCode, 0, prepared.stderr);
  const id = JSON.parse(prepared.stdout).id;
  assert.equal(JSON.parse(prepared.stdout).phase, "prepared-references-only");
  assert.equal(current.harness.inspection.sdk.calls.length, 4);
  const shown = await run(["continuity", "show", bob.botId, id, "--json"]);
  assert.equal(shown.exitCode, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).safeToExecuteTransition, false);
  current = await current.harness.lifecycle.reload(plugin);
  const replay = await run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).id, id);
  assert.equal(JSON.parse(replay.stdout).replay, true);
  const reloaded = await run(["continuity", "show", bob.botId, id, "--json"]);
  assert.equal(reloaded.exitCode, 0, reloaded.stderr);
  assert.equal(JSON.parse(reloaded.stdout).sourceThreadId, "thr_main");
  assert.equal(current.harness.inspection.sdk.calls.length, 0);
});
