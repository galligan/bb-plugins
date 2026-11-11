import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { createSchema, viewSchema } from "../setup/contracts.ts";

test("UI lookup resolves only durable creation/ownership and returns explicit absence for every key", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  plugin(bb);
  const store = openSetup(bb.storage);
  const requestId = randomUUID();
  assert.equal(await harness.behavior.callRpc("creation", { requestId }), null);
  const setup = store.plan(
    createSchema.parse({ requestId, hostId: "fixture-host" }),
  );
  const partial = viewSchema.parse(
    await harness.behavior.callRpc("creation", { requestId }),
  );
  assert.equal(partial.bot.id, setup.botId);
  assert.equal(partial.setup.phase, "planned");
  store.phase(setup.botId, "planned", "spawning");
  store.bind(setup.botId, "thr_owned");
  assert.deepEqual(
    await harness.behavior.callRpc("ownership", {
      keys: ["thr_owned", "thr_foreign"],
    }),
    {
      thr_owned: { botId: setup.botId, name: "Bob", role: "main" },
      thr_foreign: null,
    },
  );
  await assert.rejects(
    harness.behavior.callRpc("ownership", { keys: Array(201).fill("foreign") }),
  );
  await assert.rejects(
    harness.behavior.callRpc("creation", { requestId: "not-a-uuid" }),
  );
  assert.equal(harness.inspection.sdk.calls.length, 0);
});

test("CLI soul writes invalidate UI reads once and stale rejected edits do not invalidate", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  plugin(bb);
  const setup = openSetup(bb.storage).plan(
    createSchema.parse({ requestId: randomUUID(), hostId: "fixture-host" }),
  );
  const args = [
    "soul",
    "update",
    setup.botId,
    "--revision",
    "1",
    "--markdown",
    "Be direct.",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit user instruction",
    "--json",
  ];
  assert.equal((await harness.behavior.runCli(args)).exitCode, 0);
  assert.deepEqual(harness.inspection.experimental_rpcInvalidations, [
    ["bots"],
  ]);
  assert.equal((await harness.behavior.runCli(args)).exitCode, 1);
  assert.deepEqual(harness.inspection.experimental_rpcInvalidations, [
    ["bots"],
  ]);
  assert.equal(harness.inspection.sdk.calls.length, 0);
});
