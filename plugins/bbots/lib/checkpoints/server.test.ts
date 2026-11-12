import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";

test("real checkpoint CLI preserves selection through reload, refuses canceled/foreign callers and exports JSON/Markdown without native calls", async (t) => {
  let current = createFakePluginHost({ pluginId: "bbots" });
  plugin(current.bb);
  t.after(() => current.harness.lifecycle.dispose());
  const setup = openSetup(current.bb.storage);
  const bot = setup.plan({
    requestId: randomUUID(),
    hostId: "host_fixture",
    name: "Bob",
    associations: { mode: "none" },
  });
  const other = setup.plan({
    requestId: randomUUID(),
    hostId: "host_fixture",
    name: "Alice",
    associations: { mode: "none" },
  });
  setup.conversations.bindInitialThread(bot.conversationId, "thr_bob");
  setup.conversations.bindInitialThread(other.conversationId, "thr_alice");
  const run = (args: string[], threadId = "thr_bob", signal?: AbortSignal) =>
    current.harness.behavior.runCli(args, { threadId, signal });
  const args = [
    "checkpoint",
    "create",
    bot.botId,
    "--name",
    "Explicit CLI checkpoint",
    "--request-id",
    randomUUID(),
    "--author",
    "fixture-user",
    "--reason",
    "Explicit user request",
    "--json",
  ];
  const controller = new AbortController();
  controller.abort();
  assert.equal((await run(args, "thr_bob", controller.signal)).exitCode, 1);
  assert.deepEqual(
    JSON.parse((await run(["checkpoint", "list", bot.botId, "--json"])).stdout)
      .items,
    [],
  );
  const created = await run(args);
  assert.equal(created.exitCode, 0, created.stderr);
  const saved = JSON.parse(created.stdout);
  assert.equal(saved.selectedDocuments, 1);
  assert.equal(
    (
      await run(
        ["checkpoint", "show", bot.botId, saved.checkpoint.id],
        "thr_alice",
      )
    ).exitCode,
    1,
  );
  current = await current.harness.lifecycle.reload(plugin);
  const replay = await run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replay, true);
  const output = await run([
    "checkpoint",
    "export",
    bot.botId,
    saved.checkpoint.id,
    "--format",
    "json",
  ]);
  assert.equal(output.exitCode, 0, output.stderr);
  const page = JSON.parse(output.stdout);
  assert.equal(page.format, "bbots-checkpoint");
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.document.kind, "soul");
  assert.equal(page.nextCursor, null);
  const markdown = await run([
    "checkpoint",
    "export",
    bot.botId,
    saved.checkpoint.id,
    "--format",
    "markdown",
  ]);
  assert.equal(markdown.exitCode, 0, markdown.stderr);
  assert.ok(markdown.stdout.startsWith("# Bots checkpoint export\n"));
  assert.ok(markdown.stdout.includes(saved.checkpoint.id));
  assert.equal(current.harness.inspection.sdk.calls.length, 0);
});
