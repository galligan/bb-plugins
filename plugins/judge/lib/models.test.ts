import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";
import { customEndpoint } from "./connections.ts";
import { inputIsSensitive } from "./privacy.ts";
import judge from "../server.ts";

test("native secret descriptors, inert factory and sanitized readiness require explicit model and key", async (t) => {
  let networkCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    networkCalls++;
    throw new Error("offline only");
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const service = await createModelService(bb, openJudgeStorage(bb.storage));
    for (const key of [
      "typesafeApiKey",
      "cloudflareApiToken",
      "customApiKey",
    ]) {
      const descriptor = harness.registrations.settingsDescriptors[key];
      assert.equal(descriptor?.type, "string");
      assert.ok(descriptor && "secret" in descriptor && descriptor.secret);
    }
    assert.equal((await service.resolve({ sensitive: false })).ok, false);
    service.save({ id: "jev", connection: "typesafe", model: "fixture-jev" });
    assert.deepEqual(service.defaults(), { defaultId: null, privateId: null });
    service.setDefault("jev");
    assert.equal((await service.readiness("jev")).status, "not_configured");
    await harness.behavior.setSettings({
      typesafeApiKey: "dummy-credential-first",
    });
    const ready = await service.readiness("jev");
    assert.equal(ready.status, "configured");
    assert.equal(ready.tested, false);
    assert.ok(
      !JSON.stringify([ready, service.list(), harness.logEntries]).includes(
        "dummy-credential",
      ),
    );
    assert.equal(networkCalls, 0);
    await harness.behavior.setSettings({ typesafeApiKey: null });
    assert.equal((await service.readiness("jev")).status, "not_configured");
    assert.equal((await service.resolve({ sensitive: false })).ok, false);
    assert.equal(networkCalls, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
  const factory = createFakePluginHost({ pluginId: "judge" });
  try {
    await judge(factory.bb);
    assert.equal(networkCalls, 0);
    assert.equal(factory.harness.registrations.cli, null);
  } finally {
    await factory.harness.lifecycle.dispose();
  }
});

test("override, step, set and global precedence; private refusal never reaches cache/network callback", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { customBaseUrl: "http://localhost:12345" },
  });
  try {
    const service = await createModelService(bb, openJudgeStorage(bb.storage));
    for (const id of ["override", "step", "set", "global", "private"])
      service.save({
        id,
        connection: "custom",
        model: "fixture",
        allowPrivate: id === "private",
      });
    service.setDefault("global");
    for (const [selection, expected] of [
      [{ override: "override", step: "step", set: "set" }, "override"],
      [{ step: "step", set: "set" }, "step"],
      [{ set: "set" }, "set"],
      [{}, "global"],
    ] as const) {
      const resolved = await service.resolve({
        ...selection,
        sensitive: false,
      });
      assert.ok(resolved.ok);
      assert.equal(resolved.requestedModel, expected);
      assert.equal(resolved.model.id, expected);
    }
    let cacheOrNetwork = 0;
    const refused = await service.usingModel({ sensitive: true }, async () => {
      cacheOrNetwork++;
      return "forbidden";
    });
    assert.deepEqual(refused, {
      ok: false,
      reason: "private_not_allowed",
      code: "private_model_required",
    });
    assert.equal(cacheOrNetwork, 0);
    assert.throws(
      () => service.setDefault("global", true),
      /private_model_required/,
    );
    service.setDefault("private", true);
    const allowed = await service.usingModel(
      { sensitive: true },
      async (resolved) => {
        cacheOrNetwork++;
        assert.equal(resolved.requestedModel, "global");
        assert.equal(resolved.model.id, "private");
        assert.equal(resolved.fallbackReason, "private_not_allowed");
        assert.equal(
          resolved.connection.endpoint,
          "http://localhost:12345/v1/systemone",
        );
        return "allowed";
      },
    );
    assert.deepEqual(allowed, { ok: true, value: "allowed" });
    assert.equal(cacheOrNetwork, 1);
    const direct = await service.resolve({
      override: "private",
      sensitive: true,
    });
    assert.ok(direct.ok);
    assert.equal(direct.fallbackReason, null);
    service.save({
      id: "private",
      connection: "custom",
      model: "fixture",
      allowPrivate: false,
    });
    assert.deepEqual(await service.resolve({ sensitive: true }), {
      ok: false,
      reason: "private_not_allowed",
      code: "private_model_required",
    });
    assert.equal(cacheOrNetwork, 1);
    service.remove("private");
    assert.equal(service.defaults().privateId, null);
    service.remove("global");
    assert.equal(service.defaults().defaultId, null);
    assert.throws(() => service.setDefault("missing"), /missing_model/);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("ad hoc disclosure cannot downgrade source data or caller source overrides", () => {
  assert.equal(inputIsSensitive({ origin: "ad_hoc" }), true);
  assert.equal(inputIsSensitive({ origin: "ad_hoc", notPrivate: true }), false);
  assert.equal(inputIsSensitive({ origin: "source", notPrivate: true }), true);
  assert.equal(
    inputIsSensitive({ origin: "source", sourceSensitive: false }),
    false,
  );
  assert.equal(
    inputIsSensitive({
      origin: "source_override",
      sourceSensitive: false,
      notPrivate: true,
    }),
    true,
  );
});

test("rotation/removal/reload re-read settings and retire opaque fingerprints without hashing keys", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { typesafeApiKey: "dummy-first" },
  });
  try {
    const repo = openJudgeStorage(bb.storage);
    let service = await createModelService(bb, repo);
    service.save({ id: "jev", connection: "typesafe", model: "fixture" });
    service.setDefault("jev");
    const first = await service.resolve({ sensitive: false });
    assert.ok(first.ok);
    let invalidations = 0;
    const unsubscribe = service.onInvalidate(() => {
      invalidations++;
    });
    const db = bb.storage.database();
    db.prepare(
      "INSERT INTO cache(key, created_at, response_json) VALUES ('old', 0, '{}')",
    ).run();
    db.prepare(
      "INSERT INTO calibration_acceptance VALUES ('set1', 'hash', '[]', 'test1', 0)",
    ).run();
    await harness.behavior.setSettings({ typesafeApiKey: "dummy-second" });
    assert.equal(await service.isCurrent(first.identity), false);
    const second = await service.resolve({ sensitive: false });
    assert.ok(second.ok);
    assert.notEqual(first.identity.fingerprint, second.identity.fingerprint);
    assert.equal(invalidations, 1);
    assert.deepEqual(db.prepare("SELECT * FROM cache").all(), []);
    assert.deepEqual(
      db.prepare("SELECT * FROM calibration_acceptance").all(),
      [],
    );
    unsubscribe();
    await harness.behavior.setSettings({ typesafeApiKey: null });
    assert.equal((await service.readiness("jev")).status, "not_configured");
    await harness.behavior.setSettings({ typesafeApiKey: "dummy-second" });
    const old = service;
    await harness.lifecycle.reload(async (next) => {
      service = await createModelService(next, openJudgeStorage(next.storage));
    });
    assert.equal((await service.readiness("jev")).status, "configured");
    const reloaded = await service.resolve({ sensitive: false });
    assert.ok(reloaded.ok);
    assert.notEqual(second.identity.fingerprint, reloaded.identity.fingerprint);
    assert.equal(await old.isCurrent(second.identity), false);
    assert.throws(() => old.list(), /cancelled/);
    assert.ok(
      !JSON.stringify([
        service.list(),
        service.defaults(),
        first.identity,
        second.identity,
        harness.logEntries,
      ]).includes("dummy-"),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("endpoint validation, optional custom keys and fixed Workers AI model selection", async () => {
  for (const [input, output] of [
    ["https://example.com/", "https://example.com/v1/systemone"],
    ["http://localhost:1234/v1", "http://localhost:1234/v1/systemone"],
    [
      "https://example.com/root/v1/systemone/",
      "https://example.com/root/v1/systemone",
    ],
  ])
    assert.equal(customEndpoint(input!), output);
  for (const input of [
    "",
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com?secret=x",
    "https://example.com#fragment",
    " /v1/systemone",
    "https://example.com/v1/systemone/v1/systemone",
  ])
    assert.throws(() => customEndpoint(input), /invalid_endpoint/);
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const service = await createModelService(bb, openJudgeStorage(bb.storage));
    service.save({ id: "custom", connection: "custom", model: "compatible" });
    assert.equal((await service.readiness("custom")).code, "missing_url");
    await harness.behavior.setSettings({
      customBaseUrl: "http://localhost:1234",
    });
    assert.equal((await service.readiness("custom")).status, "configured");
    await assert.rejects(
      harness.behavior.setSettings({
        customBaseUrl: "https://user:pass@example.com",
      }),
    );
    await assert.rejects(
      harness.behavior.setSettings({ typesafeApiKey: "dummy\nheader" }),
    );
    assert.throws(
      () =>
        service.save({ id: "cf", connection: "cloudflare", model: "unknown" }),
      /unsupported_model/,
    );
    service.save({ id: "cf", connection: "cloudflare", model: "clef-flash" });
    assert.equal((await service.readiness("cf")).code, "missing_account");
    await harness.behavior.setSettings({ cloudflareAccountId: "a".repeat(32) });
    assert.equal((await service.readiness("cf")).code, "missing_key");
    await harness.behavior.setSettings({ cloudflareApiToken: "dummy-cf" });
    assert.equal((await service.readiness("cf")).status, "configured");
  } finally {
    await harness.lifecycle.dispose();
  }
});
