import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";

test("explicit model checks use one sanitized contract and never probe missing configuration", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const service = await createModelService(bb, openJudgeStorage(bb.storage));
    service.save({ id: "jev", connection: "typesafe", model: "fixture" });
    let calls = 0;
    const probe = async () => {
      calls++;
      return "reachable" as const;
    };
    assert.equal(
      (await service.checkModel("jev", probe)).status,
      "not_configured",
    );
    assert.equal(calls, 0);
    await harness.behavior.setSettings({ typesafeApiKey: "dummy-jev" });
    const success = await service.checkModel("jev", probe);
    assert.equal(success.status, "reachable");
    assert.equal(success.tested, true);
    assert.ok(success.latencyMs! >= 0);
    assert.equal(calls, 1);
    for (const status of [
      "authentication_failed",
      "unsupported_model",
      "error",
    ] as const) {
      const result = await service.checkModel("jev", async () => status);
      assert.equal(result.status, status);
      assert.equal(result.code, status);
    }
    const failure = await service.checkModel("jev", async () => {
      throw new Error("dummy-jev upstream body");
    });
    assert.equal(failure.status, "error");
    assert.ok(!JSON.stringify(failure).includes("dummy-jev"));
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("model, endpoint and default edits invalidate fingerprints and in-flight operations", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { customBaseUrl: "http://localhost:1234" },
  });
  try {
    const repo = openJudgeStorage(bb.storage);
    const service = await createModelService(bb, repo);
    service.save({ id: "model", connection: "custom", model: "fixture" });
    service.setDefault("model");
    const first = await service.resolve({ sensitive: false });
    assert.ok(first.ok);
    service.save({ id: "model", connection: "custom", model: "changed" });
    assert.equal(await service.isCurrent(first.identity), false);
    const second = await service.resolve({ sensitive: false });
    assert.ok(second.ok);
    await harness.behavior.setSettings({
      customBaseUrl: "http://localhost:1235",
    });
    assert.equal(await service.isCurrent(second.identity), false);
    const stale = await service.usingModel({ sensitive: false }, async () => {
      service.setDefault(null);
      return "old_answer";
    });
    assert.deepEqual(stale, {
      ok: false,
      reason: "cancelled",
      code: "configuration_changed",
    });
    service.setDefault("model");
    const check = await service.checkModel("model", async () => {
      service.remove("model");
      return "reachable";
    });
    assert.equal(check.status, "cancelled");
    assert.equal(check.tested, true);
    assert.ok(check.latencyMs! >= 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("cache invalidation failure blocks subsequent inference entry", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { typesafeApiKey: "dummy-first" },
  });
  try {
    const repo = openJudgeStorage(bb.storage);
    const service = await createModelService(bb, repo);
    service.save({ id: "model", connection: "typesafe", model: "fixture" });
    service.setDefault("model");
    bb.storage
      .database()
      .exec(
        "INSERT INTO cache VALUES ('old', 0, '{}'); CREATE TRIGGER deny_prune BEFORE DELETE ON cache BEGIN SELECT RAISE(ABORT, 'private path'); END",
      );
    await harness.behavior.setSettings({ typesafeApiKey: "dummy-second" });
    let called = false;
    await assert.rejects(
      service.usingModel({ sensitive: false }, async () => {
        called = true;
      }),
      /configuration_invalidation_failed/,
    );
    assert.equal(called, false);
    assert.ok(!JSON.stringify(harness.logEntries).includes("private path"));
  } finally {
    await harness.lifecycle.dispose();
  }
});
