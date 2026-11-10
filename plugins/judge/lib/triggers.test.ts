import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  fixtureHostOptions,
  setupRunner,
  definition,
} from "./runner-fixtures.ts";
import {
  setupEvaluation,
  evaluationDefinition,
} from "./evaluation-fixtures.ts";
import { TriggerService } from "./triggers.ts";
import { PersistenceError } from "./storage.ts";
const binding = {
  id: "attention",
  setId: "synthetic",
  event: "thread.idle",
  badges: { accepted: "Needs attention" },
};
async function setup() {
  const h = await setupRunner(createFakePluginHost(fixtureHostOptions));
  const triggers = new TriggerService(
    h.repository.triggers,
    h.api.sets,
    h.api.models,
  );
  return { ...h, triggers };
}

test("trigger saves are inert, edits/toggles retire revisions, and strict management never accepts actions or enabled imports", async () => {
  const h = await setup();
  try {
    const saved = h.triggers.save(binding);
    assert.equal(saved.enabled, false);
    assert.equal(saved.definition.projects, "all");
    assert.equal(h.bodies.length, 0);
    const enabled = h.triggers.enable("attention", true);
    assert.equal(enabled.enabled, true);
    assert.notEqual(saved.revision, enabled.revision);
    const edited = h.triggers.save(binding);
    assert.equal(edited.enabled, false);
    assert.notEqual(edited.revision, enabled.revision);
    assert.equal(edited.hash, saved.hash);
    for (const bad of [
      { ...binding, enabled: true },
      { ...binding, actions: [{ send: "bad" }] },
      { ...binding, event: "message.dispatch" },
      { ...binding, projects: ["p", "p"] },
      { ...binding, badges: { missing: "Unknown" } },
      { ...binding, badges: { accepted: "\n" } },
      { ...binding, setId: "missing" },
    ])
      assert.throws(() => h.triggers.save(bad));
    assert.equal(h.triggers.get("attention")?.revision, edited.revision);
    h.triggers.save({ ...binding, id: "b", event: "turn.failed", badges: {} });
    const page = h.triggers.list({ limit: 1 });
    assert.equal(page.triggers[0]?.definition.id, "attention");
    assert.equal(page.next, "attention");
    assert.equal(h.triggers.list({ limit: 1, after: page.next }).next, null);
    h.triggers.remove("b");
    assert.equal(h.triggers.get("b"), null);
    h.triggers.enable("attention", true);
    assert.equal(h.triggers.get("attention")?.enabled, true);
    h.api.sets.save(JSON.stringify(definition()));
    assert.equal(h.triggers.get("attention")?.enabled, false);
    h.triggers.enable("attention", true);
    h.api.sets.project("project", true);
    assert.equal(h.triggers.get("attention")?.enabled, false);
    h.api.sets.remove("synthetic");
    assert.throws(() => h.triggers.enable("attention", true));
  } finally {
    h.triggers.dispose();
    await h.harness.lifecycle.dispose();
  }
});

test("trigger changes preserve accepted model evidence; pre-write lifecycle guards and contained listeners keep mutations truthful", async () => {
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  const triggers = new TriggerService(
    h.repository.triggers,
    h.api.sets,
    h.api.models,
  );
  try {
    const def = evaluationDefinition();
    def.cases = def.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(def));
    const report = await h.api.evaluations.test({ id: "synthetic" });
    await h.api.calibration.accept("synthetic", report.id);
    const generation = h.api.models.configurationGeneration();
    let observed = 0;
    triggers.onChange(() => {
      throw new Error("dummy-listener-error");
    });
    triggers.onChange(() => {
      observed++;
    });
    const saved = triggers.save(binding);
    assert.equal(observed, 1);
    assert.equal(triggers.enable("attention", true).enabled, true);
    assert.equal(observed, 2);
    assert.equal(h.api.models.configurationGeneration(), generation);
    assert.equal(
      (await h.api.calibration.get("synthetic"))?.testRunId,
      report.id,
    );
    const before = triggers.get("attention");
    triggers.dispose();
    assert.throws(() => triggers.save(binding));
    assert.throws(() => triggers.enable("attention", false));
    assert.throws(() => triggers.remove("attention"));
    assert.deepEqual(h.repository.triggers.get("attention"), before);
    assert.equal(saved.enabled, false);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("trigger storage rejects inconsistent/corrupt rows and caps event scanning without losing configurations", async () => {
  const h = await setup();
  try {
    h.triggers.save(binding);
    h.triggers.enable("attention", true);
    const db = h.bb.storage.database();
    assert.equal(h.repository.triggers.enabled("thread.idle").length, 1);
    const row = db
      .prepare("SELECT config_json FROM triggers WHERE id='attention'")
      .get() as { config_json: string };
    for (const corrupt of [
      { ...JSON.parse(row.config_json), hash: "a".repeat(64) },
      { ...JSON.parse(row.config_json), enabled: true },
      {
        ...JSON.parse(row.config_json),
        definition: { ...JSON.parse(row.config_json).definition, id: "wrong" },
      },
    ]) {
      db.prepare("UPDATE triggers SET config_json=? WHERE id='attention'").run(
        JSON.stringify(corrupt),
      );
      assert.throws(() => h.triggers.get("attention"), PersistenceError);
    }
    h.triggers.remove("attention");
    assert.equal(h.repository.triggers.get("attention"), null);
    for (let i = 0; i < 1000; i++)
      h.triggers.save({
        ...binding,
        id: `binding-${String(i).padStart(4, "0")}`,
      });
    assert.throws(
      () => h.triggers.save({ ...binding, id: "excess" }),
      PersistenceError,
    );
    assert.equal(h.repository.triggers.enabled("thread.idle").length, 0);
    assert.equal(
      h.triggers.save({ ...binding, id: "binding-0000" }).enabled,
      false,
    );
  } finally {
    h.triggers.dispose();
    await h.harness.lifecycle.dispose();
  }
});
