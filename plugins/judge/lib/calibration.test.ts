import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions } from "./runner-fixtures.ts";
import {
  evaluationDefinition,
  recordedEvaluation,
  setupEvaluation,
} from "./evaluation-fixtures.ts";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import type { ModelIdentity } from "./models.ts";
import { createModelService } from "./models.ts";
import { JudgeApi } from "./api.ts";

async function setup() {
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  const definition = evaluationDefinition();
  definition.cases = definition.cases.slice(0, 3);
  h.api.sets.save(JSON.stringify(definition));
  return { ...h, definition };
}
test("intended calibratedFor is not acceptance; explicit acceptance covers actual fallback fingerprints and exact set hash", async () => {
  const h = await setup();
  try {
    const inputs = h.definition.cases[0]!.inputs;
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs })).calibrated,
      false,
    );
    const report = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(report.complete, true);
    assert.equal(report.variants[0]?.counts.incorrect, 1);
    assert.deepEqual(
      report.variants[0]?.identities.map((i) => i.id),
      ["private"],
    );
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    const accepted = await h.harness.behavior.callRpc("calibration.accept", {
      id: "synthetic",
      run: report.id,
    });
    assert.deepEqual(accepted, {
      setId: "synthetic",
      ...h.repository.evaluations.getAcceptance("synthetic")!,
    });
    assert.deepEqual(
      await h.harness.behavior.callRpc("calibration.get", { id: "synthetic" }),
      accepted,
    );
    assert.deepEqual(
      h.repository.evaluations.getAcceptance("synthetic")!.modelFingerprints,
      report.variants[0]!.identities.map((i) => i.fingerprint),
    );
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs })).calibrated,
      true,
    );
    // Live public provider.id resolves public rather than the case's private fallback.
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", threadId: "thread" }))
        .calibrated,
      false,
    );
    assert.equal(
      (
        await h.api.runner.run({
          id: "synthetic",
          threadId: "thread",
          model: "private",
        })
      ).calibrated,
      true,
    );
    await assert.rejects(h.api.calibration.accept("missing", report.id));
    await assert.rejects(
      h.api.calibration.accept("synthetic", "missing-report"),
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("comparison never automatically accepts the comparison model or chooses a winner", async () => {
  const h = await setup();
  try {
    for (const id of ["primary", "comparison"])
      h.api.models.save({
        id,
        model: `${id}-selector`,
        connection: "typesafe",
        allowPrivate: true,
      });
    const report = await h.api.evaluations.test({
      id: "synthetic",
      model: "primary",
      compare: "comparison",
    });
    assert.equal(report.complete, true);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    await h.api.calibration.accept("synthetic", report.id);
    const accepted = h.repository.evaluations.getAcceptance("synthetic")!;
    assert.deepEqual(
      accepted.modelFingerprints,
      report.variants[0]!.identities.map((i) => i.fingerprint),
    );
    assert.ok(
      !accepted.modelFingerprints.includes(
        report.variants[1]!.identities[0]!.fingerprint,
      ),
    );
    const inputs = h.definition.cases[0]!.inputs;
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs, model: "primary" }))
        .calibrated,
      true,
    );
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs, model: "comparison" }))
        .calibrated,
      false,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("every actually used step model including private fallbacks must be accepted", async () => {
  const h = await setup();
  try {
    h.api.models.save({
      id: "direct-private",
      model: "direct-private-selector",
      connection: "typesafe",
      allowPrivate: true,
    });
    h.definition.steps[1]!.model = "direct-private";
    h.api.sets.save(JSON.stringify(h.definition));
    const report = await h.api.evaluations.test({ id: "synthetic" });
    assert.deepEqual(
      report.variants[0]?.identities.map((i) => i.id),
      ["private", "direct-private"],
    );
    await h.api.calibration.accept("synthetic", report.id);
    const inputs = h.definition.cases[0]!.inputs;
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs })).calibrated,
      true,
    );
    // A complete report whose gate always skipped detail has not measured its model.
    const positive = h.definition.cases[0]!.inputs;
    h.definition.cases = h.definition.cases.slice(1, 2);
    h.api.sets.save(JSON.stringify(h.definition));
    const gated = await h.api.evaluations.test({ id: "synthetic" });
    assert.deepEqual(
      gated.variants[0]?.identities.map((i) => i.id),
      ["private"],
    );
    await h.api.calibration.accept("synthetic", gated.id);
    assert.equal(
      (await h.api.runner.run({ id: "synthetic", inputs: positive }))
        .calibrated,
      false,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("set/model/default/project/connection edits invalidate acceptance and make old reports stale", async () => {
  for (const kind of ["set", "model", "default", "project", "connection"]) {
    const h = await setup();
    try {
      const report = await h.api.evaluations.test({ id: "synthetic" });
      await h.api.calibration.accept("synthetic", report.id);
      if (kind === "set")
        h.api.sets.save(
          JSON.stringify({
            ...h.definition,
            description: "Changed definition",
          }),
        );
      else if (kind === "model")
        h.api.models.save({
          id: "private",
          model: "changed",
          connection: "typesafe",
          allowPrivate: true,
        });
      else if (kind === "default") h.api.models.setDefault("private");
      else if (kind === "project") h.api.sets.project("project", false);
      else
        await h.harness.behavior.setSettings({
          typesafeApiKey: "dummy-replacement-for-test-only",
        });
      assert.equal(
        h.repository.evaluations.getAcceptance("synthetic"),
        null,
        kind,
      );
      assert.equal(await h.api.calibration.get("synthetic"), null);
      await assert.rejects(
        h.api.calibration.accept("synthetic", report.id),
        kind,
      );
      assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("configuration changes in the final await gap cannot commit stale acceptance", async (t) => {
  const h = await setup();
  try {
    const report = await h.api.evaluations.test({ id: "synthetic" });
    const isCurrent = h.api.models.isCurrent.bind(h.api.models);
    let changed = false;
    t.mock.method(
      h.api.models,
      "isCurrent",
      async (identity: ModelIdentity) => {
        const current = await isCurrent(identity);
        queueMicrotask(() =>
          queueMicrotask(() => {
            h.api.models.save({
              id: "public",
              connection: "typesafe",
              model: "changed-after-current-check",
            });
            changed = true;
          }),
        );
        return current;
      },
    );
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
    assert.equal(changed, true);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("caller/disposal cancellation during acceptance never writes, and persistence failures return no acceptance", async (t) => {
  for (const reason of ["caller", "dispose", "storage"]) {
    const h = await setup();
    try {
      const report = await h.api.evaluations.test({ id: "synthetic" });
      const controller = new AbortController();
      if (reason === "storage")
        t.mock.method(h.repository.evaluations, "accept", () => {
          throw new PersistenceError();
        });
      else
        t.mock.method(h.api.models, "isCurrent", async () => {
          queueMicrotask(() =>
            reason === "caller"
              ? controller.abort()
              : h.api.calibration.dispose(),
          );
          return new Promise(() => {});
        });
      await assert.rejects(
        h.api.calibration.accept("synthetic", report.id, controller.signal),
      );
      assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("explicit CLI acceptance reports its target, while fake-host reload retires old fingerprints even at the same generation", async () => {
  const h = await setup();
  let api = h.api;
  let repository = h.repository;
  let lifecycle = h.harness.lifecycle;
  try {
    const tested = await h.harness.behavior.runCli([
      "test",
      "synthetic",
      "--json",
    ]);
    assert.equal(tested.exitCode, 0);
    const report = JSON.parse(tested.stdout);
    const accepted = await h.harness.behavior.runCli([
      "calibration",
      "accept",
      "synthetic",
      "--run",
      report.id,
      "--json",
    ]);
    assert.equal(accepted.exitCode, 0);
    assert.equal(JSON.parse(accepted.stdout).testRunId, report.id);
    const judged = await h.harness.behavior.runCli([
      "ask",
      "synthetic",
      "--thread",
      "thread",
      "--model",
      "private",
      "--json",
    ]);
    assert.equal(judged.exitCode, 0);
    assert.equal(JSON.parse(judged.stdout).calibrated, true);
    async function reload() {
      const freshHost = await lifecycle.reload(async (next) => {
        repository = openJudgeStorage(next.storage);
        api = new JudgeApi(
          await createModelService(next, repository),
          repository,
          next.sdk,
          recordedEvaluation,
        );
        next.onDispose(() => api.dispose());
      });
      lifecycle = freshHost.harness.lifecycle;
    }
    await reload();
    assert.equal(repository.evaluations.getAcceptance("synthetic"), null);
    const fresh = await api.evaluations.test({ id: "synthetic" });
    assert.equal(fresh.configurationGeneration, 0);
    await api.calibration.accept("synthetic", fresh.id);
    await reload();
    assert.equal(api.models.configurationGeneration(), 0);
    assert.ok(repository.evaluations.getReport(fresh.id));
    await assert.rejects(api.calibration.accept("synthetic", fresh.id));
    assert.equal(repository.evaluations.getAcceptance("synthetic"), null);
  } finally {
    await lifecycle.dispose();
  }
});
