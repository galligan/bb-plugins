import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";

function fixture(t: TestContext) {
  let current = createFakePluginHost({ pluginId: "bbots" });
  plugin(current.bb);
  const store = openSetup(current.bb.storage);
  function bot(name: string, thread: string) {
    const found = store.plan({
      requestId: randomUUID(),
      hostId: "host_fixture",
      name,
      associations: { mode: "none" },
    });
    store.conversations.bindInitialThread(found.conversationId, thread);
    return found;
  }
  const bob = bot("Bob", "thr_bob"),
    alice = bot("Alice", "thr_alice");
  t.after(() => current.harness.lifecycle.dispose());
  function content() {
    return [
      "--topic",
      "Preference",
      "--markdown",
      "Keep exact evidence.",
      "--basis",
      "fact",
      "--source",
      "thread:thr_bob#msg=1",
      "--author",
      "fixture-user",
      "--reason",
      "Explicit remember/capture request",
      "--json",
    ];
  }
  return {
    bob,
    alice,
    content,
    run: (args: string[], signal?: AbortSignal, threadId = "thr_bob") =>
      current.harness.behavior.runCli(args, { threadId, signal }),
    get harness() {
      return current.harness;
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
    },
  };
}

test("real CLI and brief expose bounded knowledge, then suppress it without changing SOUL, tasks or native execution", async (t) => {
  const f = fixture(t);
  const args = [
    "memory",
    "remember",
    f.bob.botId,
    "--request-id",
    randomUUID(),
    ...f.content(),
  ];
  const response = await f.run(args);
  assert.equal(response.exitCode, 0, response.stderr);
  const saved = JSON.parse(response.stdout).entry;
  let brief = await f.run(["brief", f.bob.botId, "--json"]);
  assert.equal(brief.exitCode, 0, brief.stderr);
  assert.equal(JSON.parse(brief.stdout).memory.knowledge[0].id, saved.id);
  assert.deepEqual(JSON.parse(brief.stdout).memory.captures, []);
  const refused = await f.run(
    ["memory", "show", f.bob.botId, saved.id],
    undefined,
    "thr_alice",
  );
  assert.equal(refused.exitCode, 1);
  const forgotten = await f.run([
    "memory",
    "forget",
    f.bob.botId,
    saved.id,
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--json",
  ]);
  assert.equal(forgotten.exitCode, 0, forgotten.stderr);
  assert.equal(JSON.parse(forgotten.stdout).limitations.historyRetained, true);
  assert.equal(
    JSON.parse(forgotten.stdout).limitations.liveContextRefresh,
    "not-performed",
  );
  assert.equal(forgotten.stdout.includes("Keep exact evidence"), false);
  await f.reload();
  const replay = await f.run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).entry.availability, "suppressed");
  brief = await f.run(["brief", f.bob.botId, "--json"]);
  assert.deepEqual(JSON.parse(brief.stdout).memory.knowledge, []);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("ordinary-turn capture persists its boundary across reload; cancellation and cross-bot progress access write nothing", async (t) => {
  const f = fixture(t);
  const progress = [
    "capture",
    "progress",
    f.bob.botId,
    "--stream",
    "thread:thr_bob",
    "--kind",
    "summary",
    "--json",
  ];
  const args = [
    "capture",
    f.bob.botId,
    "--kind",
    "summary",
    "--stream",
    "thread:thr_bob",
    "--from",
    "1",
    "--through",
    "3",
    "--revision",
    "0",
    "--request-id",
    randomUUID(),
    ...f.content(),
  ];
  const controller = new AbortController();
  controller.abort(new Error("User stopped this action"));
  assert.equal((await f.run(args, controller.signal)).exitCode, 1);
  assert.equal(JSON.parse((await f.run(progress)).stdout).through, 0);
  const saved = await f.run(args);
  assert.equal(saved.exitCode, 0, saved.stderr);
  const recordId = JSON.parse(saved.stdout).entry.id;
  await f.reload();
  const replay = await f.run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replay, true);
  assert.equal(JSON.parse(replay.stdout).entry.id, recordId);
  assert.equal(JSON.parse((await f.run(progress)).stdout).through, 3);
  assert.equal((await f.run(progress, undefined, "thr_alice")).exitCode, 1);
  const brief = JSON.parse(
    (await f.run(["brief", f.bob.botId, "--json"])).stdout,
  );
  assert.deepEqual(brief.memory.knowledge, []);
  assert.equal(brief.memory.captures[0].kind, "summary");
  assert.equal(brief.memory.captures[0].boundary.through, 3);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
