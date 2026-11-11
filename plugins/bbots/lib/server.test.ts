import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { statusSchema } from "./contracts.ts";

test("CLI and RPC expose the same disabled development boundary without provider work", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  plugin(bb);
  const rpc = statusSchema.parse(await harness.behavior.callRpc("status", {}));
  const cli = await harness.behavior.runCli(["status", "--json"]);
  assert.equal(cli.exitCode, 0);
  assert.deepEqual(JSON.parse(cli.stdout), rpc);
  assert.equal(rpc.automaticMaintenance, "disabled");
  assert.equal(rpc.automaticContinuity, "disabled");
  assert.equal(harness.inspection.sdk.calls.length, 0);
  assert.equal(harness.inspection.registrations.schedules.length, 0);
  assert.equal(harness.inspection.registrations.services.length, 0);
});

test("unknown operations fail visibly instead of pretending to create a bot", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  plugin(bb);
  const result = await harness.behavior.runCli(["create", "Bob", "--json"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.equal(harness.inspection.sdk.calls.length, 0);
  const status = await harness.behavior.runCli(["status"]);
  assert.match(status.stdout, /Native Stop applies per thread/);
  await assert.rejects(
    harness.behavior.callRpc("status", { botId: "untrusted" }),
  );
});

test("reload retains one registration set and disposal invalidates the old factory API", async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  plugin(bb);
  await harness.lifecycle.reload(plugin);
  assert.throws(() => plugin(bb), /stale|disposed/i);
  assert.equal((await harness.behavior.runCli(["status"])).exitCode, 0);
  assert.equal(harness.inspection.sdk.calls.length, 0);
});

test("package uses only public SDK and package-local imports", () => {
  const scan = experimental_scanPublicSdkOnly(
    fileURLToPath(new URL("..", import.meta.url)),
    { allow: [/^better-sqlite3$/] },
  );
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(scan.privateDependencies, []);
});
