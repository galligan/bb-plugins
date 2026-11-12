import assert from "node:assert/strict";
import { test } from "node:test";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { fixture, attribution } from "./restore-fixture.ts";

function catalog() {
  return {
    modelLoadError: null,
    permissionCeiling: "auto",
    providers: [
      {
        id: "fixture-provider",
        available: true,
        capabilities: {
          permissionModes: ["accept-edits", "auto"],
          supportsServiceTier: true,
        },
        serviceTiers: [{ id: "priority" }],
      },
    ],
    models: [
      {
        id: "fixture-model",
        model: "fixture-model",
        isDefault: true,
        reasoningDiscovery: "known",
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        supportedServiceTiers: [{ id: "priority" }],
      },
    ],
    selectedOnlyModels: [],
  };
}

test("execution restore validates original-host catalog without changing native threads; replay survives later provider loss", async (t) => {
  const f = fixture(t),
    botId = f.bot.botId;
  f.soul.updateDefaults({
    botId,
    expectedRevision: 0,
    defaults: {
      main: {
        providerId: "fixture-provider",
        model: "fixture-model",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "priority",
      },
      worker: null,
      fallback: null,
    },
    ...attribution,
  });
  const id = f.checkpoint();
  f.soul.updateDefaults({
    botId,
    expectedRevision: 1,
    defaults: { main: {}, worker: {}, fallback: null },
    ...attribution,
  });
  f.harness.sdk.stub("hosts.get", () =>
    makeHostResponse({ id: "host_fixture", status: "connected" }),
  );
  f.harness.sdk.stub("providers.models", () => catalog());
  const request = f.request(id, [{ kind: "execution", expectedRevision: 2 }]);
  const saved = await f.restore(request);
  assert.equal(f.soul.defaults(botId).revision, 3);
  assert.equal(f.soul.defaults(botId).defaults.main.model, "fixture-model");
  const args = f.harness.inspection.sdk.callsTo("providers.models")[0]![0] as {
    hostId: string;
    providerId: string;
    preferCached: boolean;
  };
  assert.equal(args.hostId, "host_fixture");
  assert.equal(args.providerId, "fixture-provider");
  assert.equal(args.preferCached, false);
  assert.equal(f.harness.inspection.sdk.calls.length, 2);
  f.harness.sdk.stub("providers.models", () => {
    throw new Error("Later provider loss");
  });
  const replay = await f.restore(request);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.receipt, saved.receipt);
  assert.equal(f.harness.inspection.sdk.calls.length, 2);
});

test("unavailable models/reasoning/permissions/tier or catalogs refuse the whole selection without choosing replacements", async (t) => {
  for (const scenario of [
    "offline",
    "provider",
    "catalog",
    "model",
    "reasoning",
    "permissions",
    "tier",
  ]) {
    await t.test(scenario, async (t) => {
      const f = fixture(t),
        botId = f.bot.botId;
      f.soul.updateDefaults({
        botId,
        expectedRevision: 0,
        defaults: {
          main: {
            providerId: "fixture-provider",
            model: "fixture-model",
            reasoningLevel: "high",
            permissionMode: "auto",
            serviceTier: "priority",
          },
          worker: null,
          fallback: null,
        },
        ...attribution,
      });
      const request = f.request(f.checkpoint(), [
        { kind: "soul", expectedRevision: 1 },
        { kind: "execution", expectedRevision: 1 },
      ]);
      f.harness.sdk.stub("hosts.get", () =>
        makeHostResponse({
          id: "host_fixture",
          status: scenario === "offline" ? "disconnected" : "connected",
        }),
      );
      f.harness.sdk.stub("providers.models", () => {
        const value = catalog();
        if (scenario === "provider") value.providers[0]!.available = false;
        if (scenario === "catalog") throw new Error("Catalog unavailable");
        if (scenario === "model") value.models = [];
        if (scenario === "reasoning")
          value.models[0]!.supportedReasoningEfforts = [];
        if (scenario === "permissions")
          value.permissionCeiling = "accept-edits";
        if (scenario === "tier") value.models[0]!.supportedServiceTiers = [];
        return value;
      });
      await assert.rejects(f.restore(request));
      assert.equal(f.soul.show(botId).current?.revision, 1);
      assert.equal(f.soul.defaults(botId).revision, 1);
      assert.equal(
        f.setup.documents.get(botId, `RESTORE:${request.requestId}.json`),
        null,
      );
      assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    });
  }
});

test("cancellation after catalog validation and revisions changed during lookup refuse all writes", async (t) => {
  for (const scenario of ["cancel", "stale"])
    await t.test(scenario, async (t) => {
      const f = fixture(t),
        botId = f.bot.botId,
        controller = new AbortController();
      f.soul.updateDefaults({
        botId,
        expectedRevision: 0,
        defaults: {
          main: { providerId: "fixture-provider", model: "fixture-model" },
          worker: null,
          fallback: null,
        },
        ...attribution,
      });
      const request = f.request(f.checkpoint(), [
        { kind: "profile", expectedRevision: 1 },
        { kind: "execution", expectedRevision: 1 },
      ]);
      f.harness.sdk.stub("hosts.get", () =>
        makeHostResponse({ id: "host_fixture", status: "connected" }),
      );
      f.harness.sdk.stub("providers.models", () => {
        if (scenario === "cancel")
          controller.abort(new Error("User stopped restore"));
        else
          f.soul.updateDefaults({
            botId,
            expectedRevision: 1,
            defaults: { main: {}, worker: null, fallback: null },
            ...attribution,
          });
        return catalog();
      });
      await assert.rejects(f.restore(request, controller.signal));
      assert.equal(f.setup.profiles.get(botId).revision, 1);
      assert.equal(
        f.soul.defaults(botId).revision,
        scenario === "cancel" ? 1 : 2,
      );
      assert.equal(
        f.setup.documents.get(botId, `RESTORE:${request.requestId}.json`),
        null,
      );
    });
});

test("forgetting while catalog validation is pending prevents stale historical knowledge from being restored", async (t) => {
  const f = fixture(t),
    botId = f.bot.botId;
  const note = f.memory.create(f.input()).entry;
  f.soul.updateDefaults({
    botId,
    expectedRevision: 0,
    defaults: {
      main: { providerId: "fixture-provider", model: "fixture-model" },
      worker: null,
      fallback: null,
    },
    ...attribution,
  });
  const request = f.request(f.checkpoint(), [
    { kind: "profile", expectedRevision: 1 },
    { kind: "execution", expectedRevision: 1 },
    { kind: "knowledge", id: note.id, expectedRevision: 1 },
  ]);
  f.harness.sdk.stub("hosts.get", () =>
    makeHostResponse({ id: "host_fixture", status: "connected" }),
  );
  f.harness.sdk.stub("providers.models", () => {
    f.memory.forget(botId, note.id, 1, attribution.author);
    return catalog();
  });
  await assert.rejects(f.restore(request), /excluded/);
  assert.equal(f.setup.profiles.get(botId).revision, 1);
  assert.equal(f.soul.defaults(botId).revision, 1);
  assert.equal(f.memory.show(botId, note.id).availability, "suppressed");
  assert.equal(
    f.setup.documents.get(botId, `RESTORE:${request.requestId}.json`),
    null,
  );
});
