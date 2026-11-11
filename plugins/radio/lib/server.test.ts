import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import radio from "../server.ts";

test("local surfaces register without factory SDK calls, network or execution services", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    radio(bb);
    assert.deepEqual(harness.inspection.sdk.calls, []);
    assert.equal(harness.inspection.registrations.httpRoutes.length, 2);
    assert.equal(harness.inspection.registrations.rpcMethods.length, 2);
    assert.equal(harness.inspection.registrations.agentTools.length, 1);
    assert.equal(harness.inspection.registrations.services.length, 0);
    assert.equal(harness.inspection.registrations.schedules.length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("the package uses only public SDK and package-local imports", async () => {
  const report = await experimental_scanPublicSdkOnly(
    fileURLToPath(new URL("..", import.meta.url)),
    { allow: [/^better-sqlite3$/] },
  );
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});
