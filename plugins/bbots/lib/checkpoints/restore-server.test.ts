import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";

test("real restore CLI enforces caller/cancellation/selection boundaries, persists receipt through reload and starts no native work", async (t) => {
  let current = createFakePluginHost({ pluginId: "bbots" });
  plugin(current.bb);
  t.after(() => current.harness.lifecycle.dispose());
  const store = openSetup(current.bb.storage);
  function bot(name: string, threadId: string) {
    const planned = store.plan({
      requestId: randomUUID(),
      hostId: "host_fixture",
      name,
      associations: { mode: "none" },
    });
    store.conversations.bindInitialThread(planned.conversationId, threadId);
    return planned.botId;
  }
  const bob = bot("Bob", "thr_bob");
  bot("Alice", "thr_alice");
  const run = (args: string[], threadId = "thr_bob", signal?: AbortSignal) =>
    current.harness.behavior.runCli(args, { threadId, signal });
  const checkpoint = await run([
    "checkpoint",
    "create",
    bob,
    "--name",
    "Before persona edit",
    "--request-id",
    randomUUID(),
    "--author",
    "fixture-user",
    "--reason",
    "Explicit checkpoint",
    "--json",
  ]);
  assert.equal(checkpoint.exitCode, 0, checkpoint.stderr);
  const id = JSON.parse(checkpoint.stdout).checkpoint.id;
  const edit = await run([
    "soul",
    "update",
    bob,
    "--revision",
    "1",
    "--markdown",
    "Later persona",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit persona edit",
    "--json",
  ]);
  assert.equal(edit.exitCode, 0, edit.stderr);
  const requestId = randomUUID();
  const args = [
    "checkpoint",
    "restore",
    bob,
    id,
    "--selection",
    '[{"kind":"soul","expectedRevision":2}]',
    "--request-id",
    requestId,
    "--author",
    "fixture-user",
    "--reason",
    "Explicit user approval for SOUL only",
    "--json",
  ];
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal((await run(args, "thr_bob", cancelled.signal)).exitCode, 1);
  assert.equal((await run(args, "thr_alice")).exitCode, 1);
  assert.equal(store.documents.get(bob, "SOUL.md")?.revision, 2);
  assert.equal(store.documents.get(bob, `RESTORE:${requestId}.json`), null);
  const saved = await run(args);
  assert.equal(saved.exitCode, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).replay, false);
  assert.equal(store.documents.get(bob, "SOUL.md")?.revision, 3);
  const soul = JSON.parse((await run(["soul", "show", bob, "--json"])).stdout);
  assert.equal(soul.appliedRevision, null);
  assert.notEqual(soul.current.markdown, "Later persona");
  current = await current.harness.lifecycle.reload(plugin);
  const replay = await run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replay, true);
  assert.deepEqual(
    JSON.parse(replay.stdout).receipt,
    JSON.parse(saved.stdout).receipt,
  );
  const invalid = args.map((value) =>
    value === '[{"kind":"soul","expectedRevision":2}]' ? "not-json" : value,
  );
  assert.equal((await run(invalid)).exitCode, 1);
  assert.equal(
    JSON.parse((await run(["soul", "show", bob, "--json"])).stdout).current
      .revision,
    3,
  );
  assert.equal(current.harness.inspection.sdk.calls.length, 0);
});
