import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions } from "./runner-fixtures.ts";
import {
  evaluationDefinition,
  setupEvaluation,
} from "./evaluation-fixtures.ts";
import {
  evaluationReportSchema,
  parseEvaluationReport,
} from "./evaluation-contract.ts";
import { LIMITS } from "./json.ts";
import { openJudgeStorage, MIGRATIONS, PersistenceError } from "./storage.ts";
import { summarize } from "./evaluation-summary.ts";
import { readSetYaml } from "./sets-yaml.ts";
import { modelConfigSchema } from "./contracts.ts";

async function setup() {
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  const definition = evaluationDefinition();
  definition.cases = definition.cases.slice(0, 3);
  h.api.sets.save(JSON.stringify(definition));
  const report = await h.api.evaluations.test({ id: "synthetic" });
  return { ...h, report };
}
test("evaluation records are immutable, self-consistent, and corrupt reads fail closed without raw diagnostics", async () => {
  const h = await setup();
  try {
    const { report } = h;
    const db = h.bb.storage.database();
    assert.deepEqual(h.repository.evaluations.getReport(report.id), report);
    assert.throws(
      () =>
        h.repository.evaluations.saveReport({
          ...report,
          elapsedMs: report.elapsedMs + 1,
        }),
      PersistenceError,
    );
    assert.deepEqual(h.repository.evaluations.getReport(report.id), report);
    for (const bad of [
      { ...report, cases: [] },
      { ...report, variants: [] },
      { ...report, complete: false },
      { ...report, variants: [{ ...report.variants[0]!, results: [] }] },
    ])
      assert.equal(evaluationReportSchema.safeParse(bad).success, false);
    const corrupt = structuredClone(report);
    corrupt.variants[0]!.counts.correct++;
    db.prepare(
      "UPDATE evaluation_reports SET report_json = ? WHERE id = ?",
    ).run(JSON.stringify(corrupt), report.id);
    assert.throws(
      () => h.repository.evaluations.getReport(report.id),
      PersistenceError,
    );
    db.prepare(
      "UPDATE evaluation_reports SET report_json = ? WHERE id = ?",
    ).run("private-corruption-sentinel", report.id);
    assert.throws(
      () => h.repository.evaluations.getReport(report.id),
      (error: unknown) =>
        error instanceof PersistenceError &&
        !error.message.includes("sentinel"),
    );
    assert.throws(() =>
      parseEvaluationReport({
        oversized: "x".repeat(LIMITS.responseBytes + 1),
      }),
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("available cases cannot retain unavailable steps or establish calibration from contradictory stored evidence", async () => {
  const h = await setup();
  try {
    const db = h.bb.storage.database();
    for (const index of [0, 2]) {
      const corrupt = structuredClone(h.report);
      const variant = corrupt.variants[0]!;
      const result = variant.results[index]!;
      assert.equal(result.status, index === 0 ? "correct" : "incorrect");
      assert.ok(result.steps.ran > 0);
      result.steps.ran--;
      result.steps.unavailable++;
      Object.assign(variant, summarize(corrupt.cases, variant.results));
      assert.equal(corrupt.complete, true);
      assert.equal(variant.counts.unavailable, 0);
      assert.equal(variant.steps.unavailable, 1);
      assert.equal(evaluationReportSchema.safeParse(corrupt).success, false);
      assert.throws(() => parseEvaluationReport(corrupt));
      assert.throws(() =>
        h.repository.evaluations.saveReport({
          ...corrupt,
          id: `contradictory-${index}`,
        }),
      );
      db.prepare(
        "UPDATE evaluation_reports SET report_json = ? WHERE id = ?",
      ).run(JSON.stringify(corrupt), h.report.id);
      assert.throws(
        () => h.repository.evaluations.getReport(h.report.id),
        PersistenceError,
      );
      await assert.rejects(
        h.api.calibration.accept("synthetic", h.report.id),
        PersistenceError,
      );
      assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
      db.prepare(
        "UPDATE evaluation_reports SET report_json = ? WHERE id = ?",
      ).run(JSON.stringify(h.report), h.report.id);
    }
    // Incorrect expectations remain an explicit caller decision when all evidence is available.
    assert.equal(h.report.variants[0]!.counts.incorrect, 1);
    assert.ok(await h.api.calibration.accept("synthetic", h.report.id));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("acceptance rejects missing/partial evidence, wrong fingerprints and corrupt linkage", async () => {
  const h = await setup();
  try {
    const { report } = h;
    const valid = {
      setHash: report.set.hash,
      modelFingerprints: report.variants[0]!.identities.map(
        (i) => i.fingerprint,
      ),
      testRunId: report.id,
      acceptedAt: Date.now(),
    };
    for (const bad of [
      { ...valid, testRunId: "missing" },
      { ...valid, modelFingerprints: [] },
      { ...valid, modelFingerprints: ["f".repeat(64)] },
      {
        ...valid,
        modelFingerprints: [
          ...valid.modelFingerprints,
          ...valid.modelFingerprints,
        ],
      },
      { ...valid, acceptedAt: report.endedAt - 1 },
    ])
      assert.throws(() => h.repository.evaluations.accept("synthetic", bad));
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    await h.api.calibration.accept("synthetic", report.id);
    const db = h.bb.storage.database();
    db.prepare(
      "UPDATE calibration_acceptance SET fingerprints_json = ? WHERE set_id = ?",
    ).run(JSON.stringify(["e".repeat(64)]), "synthetic");
    assert.throws(
      () => h.repository.evaluations.getAcceptance("synthetic"),
      PersistenceError,
    );
    await assert.rejects(h.api.calibration.get("synthetic"), PersistenceError);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("a self-consistent subset report still cannot masquerade as the full saved suite at acceptance", async () => {
  const h = await setup();
  try {
    const subset = structuredClone(h.report);
    subset.id = "partial-suite";
    subset.cases = subset.cases.slice(0, 1);
    subset.variants[0]!.results = subset.variants[0]!.results.slice(0, 1);
    Object.assign(
      subset.variants[0]!,
      summarize(subset.cases, subset.variants[0]!.results),
    );
    subset.plannedRequestsUpperBound = subset.stepsPerCase;
    assert.equal(parseEvaluationReport(subset).complete, true);
    h.repository.evaluations.saveReport(subset);
    await assert.rejects(h.api.calibration.accept("synthetic", subset.id));
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("bounded report retention expires linked acceptance and a failed report transaction preserves prior evidence", async () => {
  const h = await setup();
  try {
    const db = h.bb.storage.database();
    const { report } = h;
    await h.api.calibration.accept("synthetic", report.id);
    db.exec(
      "CREATE TRIGGER fail_eval BEFORE INSERT ON evaluation_reports BEGIN SELECT RAISE(ABORT, 'dummy-private-database-detail'); END;",
    );
    assert.throws(
      () =>
        h.repository.evaluations.saveReport({ ...report, id: "failed-copy" }),
      PersistenceError,
    );
    assert.ok(h.repository.evaluations.getAcceptance("synthetic"));
    db.exec("DROP TRIGGER fail_eval");
    for (let index = 0; index < 1000; index++) {
      const startedAt = report.startedAt + 1000 + index;
      h.repository.evaluations.saveReport(
        {
          ...report,
          id: `retained-${String(index).padStart(4, "0")}`,
          startedAt,
          endedAt: startedAt + 1,
        },
        report.startedAt + 3000,
      );
    }
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM evaluation_reports").get() as {
          n: number;
        }
      ).n,
      1000,
    );
    assert.equal(h.repository.evaluations.getReport(report.id), null);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    assert.ok(h.repository.evaluations.getReport("retained-0999"));
    const startedAt = report.startedAt - LIMITS.runAgeMs - 1;
    h.repository.evaluations.saveReport(
      { ...report, id: "expired-report", startedAt, endedAt: startedAt + 1 },
      report.startedAt + 3000,
    );
    assert.equal(h.repository.evaluations.getReport("expired-report"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("appended evaluation migrations preserve populated legacy definitions, models, defaults and ordered run rows", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS.slice(0, 11));
    const saved = readSetYaml(JSON.stringify(evaluationDefinition()));
    const model = modelConfigSchema.parse({
      id: "legacy-model",
      connection: "typesafe",
      model: "synthetic",
    });
    db.prepare("INSERT INTO models VALUES (?, ?)").run(
      model.id,
      JSON.stringify(model),
    );
    db.prepare("INSERT INTO model_defaults VALUES (1, ?, NULL)").run(model.id);
    db.prepare("INSERT INTO question_sets VALUES (?, ?, ?, ?, ?)").run(
      saved.definition.id,
      1,
      "global",
      saved.hash,
      saved.yaml,
    );
    const summary = {
      runId: "legacy-run",
      set: null,
      threadId: null,
      projectId: null,
      startedAt: Date.now(),
      endedAt: Date.now(),
      complete: false,
      calibrated: false,
      outcomes: {},
    };
    db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?)").run(
      summary.runId,
      null,
      null,
      summary.startedAt,
      JSON.stringify(summary),
    );
    db.prepare(
      "INSERT INTO steps(run_id, id, result_json, ordinal) VALUES (?, ?, ?, 0)",
    ).run(
      summary.runId,
      "main",
      JSON.stringify({
        status: "unavailable",
        reason: "not_configured",
        code: "legacy",
      }),
    );
    const repository = openJudgeStorage(bb.storage);
    assert.deepEqual(repository.getModel(model.id), model);
    assert.equal(repository.getDefaults().defaultId, model.id);
    assert.equal(
      repository.definitions.getSet(saved.definition.id)?.yaml,
      saved.yaml,
    );
    assert.equal(
      repository.getRun("legacy-run")?.steps.main?.status,
      "unavailable",
    );
    assert.equal(repository.evaluations.getReport("missing"), null);
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM evaluation_reports").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
