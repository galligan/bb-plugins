import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions } from "./runner-fixtures.ts";
import {
  evaluationDefinition,
  setupEvaluation,
} from "./evaluation-fixtures.ts";
import { parseEvaluationReport } from "./evaluation-contract.ts";
import { PersistenceError } from "./storage.ts";

const setup = (fetcher?: typeof fetch) =>
  setupEvaluation(createFakePluginHost(fixtureHostOptions), fetcher);

test("recorded evaluation separates incorrect from unavailable, reports outcome rates/steps/fallbacks, and stores no payloads", async () => {
  const h = await setup();
  try {
    const report = parseEvaluationReport(
      await h.harness.behavior.callRpc("test", { id: "synthetic" }),
    );
    const primary = report.variants[0]!;
    assert.deepEqual(
      primary.results.map((c) => c.status),
      ["correct", "correct", "incorrect", "unavailable"],
    );
    assert.deepEqual(primary.counts, {
      correct: 2,
      incorrect: 1,
      unavailable: 1,
    });
    assert.deepEqual(primary.steps, { ran: 5, skipped: 2, unavailable: 1 });
    assert.deepEqual(primary.outcomes.accepted, {
      correct: 2,
      incorrect: 1,
      unavailable: 1,
      accuracy: 2 / 3,
    });
    assert.deepEqual(primary.outcomes.claimed, {
      correct: 3,
      incorrect: 0,
      unavailable: 1,
      accuracy: 1,
    });
    assert.equal(report.complete, false);
    assert.equal(report.stale, false);
    assert.equal(report.plannedRequestsUpperBound, 8);
    assert.deepEqual(primary.requestedModels, ["public"]);
    assert.equal(primary.identities[0]?.id, "private");
    assert.equal(primary.identities.length, 1);
    assert.match(report.modelLabelLimitation, /immutable weights/);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    assert.equal(h.bodies.length, 6);
    const stored = h.repository.evaluations.getReport(report.id);
    assert.deepEqual(stored, report);
    assert.deepEqual(
      await h.harness.behavior.callRpc("tests.get", { id: report.id }),
      report,
    );
    const json = JSON.stringify(stored);
    for (const forbidden of [
      "FIXTURE_ONLY",
      "dummy-runner-secret",
      "dummy-private-upstream-error",
      '"answers"',
      '"inputs"',
    ])
      assert.ok(!json.includes(forbidden), forbidden);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("comparison exposes disagreements and actual identities without inventing a winner", async () => {
  const h = await setup();
  try {
    const set = evaluationDefinition();
    set.cases = set.cases.slice(0, 3);
    h.api.sets.save(JSON.stringify(set));
    for (const [id, model] of [
      ["primary", "primary-selector"],
      ["comparison", "comparison-selector"],
    ])
      h.api.models.save({
        id,
        model,
        connection: "typesafe",
        allowPrivate: true,
      });
    const report = await h.api.evaluations.test({
      id: "synthetic",
      model: "primary",
      compare: "comparison",
    });
    assert.equal(report.complete, true);
    assert.equal(report.variants.length, 2);
    assert.deepEqual(report.disagreements, [
      { index: 0, status: "disagree", outcomes: ["accepted"] },
      { index: 1, status: "agree", outcomes: [] },
      { index: 2, status: "disagree", outcomes: ["accepted"] },
    ]);
    assert.deepEqual(
      report.variants.map((v) => v.counts),
      [
        { correct: 2, incorrect: 1, unavailable: 0 },
        { correct: 2, incorrect: 1, unavailable: 0 },
      ],
    );
    assert.equal(report.variants[0]?.identities[0]?.id, "primary");
    assert.equal(report.variants[1]?.identities[0]?.id, "comparison");
    assert.equal(Object.hasOwn(report, "winner"), false);
    assert.equal(Object.hasOwn(report, "bestModel"), false);
    assert.equal(h.bodies.length, 10);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    await assert.rejects(
      h.api.evaluations.test({
        id: "synthetic",
        model: "primary",
        compare: "primary",
      }),
    );
    assert.equal(h.bodies.length, 10);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("unavailable comparison is not treated as agreement or proof the other model wins", async () => {
  const h = await setup();
  try {
    const set = evaluationDefinition();
    set.cases = set.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(set));
    const report = await h.api.evaluations.test({
      id: "synthetic",
      compare: "missing-model",
    });
    assert.equal(report.complete, false);
    assert.deepEqual(report.disagreements, [
      { index: 0, status: "unavailable", outcomes: [] },
    ]);
    assert.deepEqual(report.variants[1]?.outcomes.accepted, {
      correct: 0,
      incorrect: 0,
      unavailable: 1,
      accuracy: null,
    });
    assert.equal(
      report.variants[1]?.results[0]?.failure?.reason,
      "not_configured",
    );
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("case payloads retain private policy and project applicability before dispatch", async () => {
  const h = await setup();
  try {
    h.api.models.setDefault(null, true);
    const denied = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(denied.complete, false);
    assert.equal(denied.variants[0]?.counts.unavailable, 4);
    assert.equal(
      denied.variants[0]?.results[0]?.failure?.reason,
      "private_not_allowed",
    );
    assert.equal(h.bodies.length, 0);
    h.api.models.setDefault("private", true);
    h.api.sets.project("project", false);
    const off = await h.api.evaluations.test({
      id: "synthetic",
      projectId: "project",
    });
    assert.equal(
      off.variants[0]?.results[0]?.failure?.code,
      "set_not_applicable",
    );
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    await assert.rejects(
      h.harness.behavior.callRpc("test", { id: "synthetic", notPrivate: true }),
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("evaluation CLI/RPC expose explicit cost/privacy, stable reports and structured management errors", async () => {
  const h = await setup();
  try {
    for (const args of [["test"], ["calibration"], ["calibration", "accept"]]) {
      const help = await h.harness.behavior.runCli([...args, "--help"]);
      assert.equal(help.exitCode, 0);
    }
    const help = await h.harness.behavior.runCli(["test", "--help"]);
    assert.match(help.stdout, /charges|sensitive/);
    const result = await h.harness.behavior.runCli([
      "test",
      "synthetic",
      "--json",
    ]);
    assert.equal(result.exitCode, 0);
    const report = parseEvaluationReport(JSON.parse(result.stdout));
    assert.equal(report.complete, false);
    const denied = await h.harness.behavior.runCli([
      "calibration",
      "accept",
      "synthetic",
      "--run",
      report.id,
      "--json",
    ]);
    assert.equal(denied.exitCode, 1);
    for (const args of [
      ["test", "missing"],
      ["test", "synthetic", "--not-private"],
      ["calibration", "accept", "synthetic"],
    ])
      assert.equal(
        (await h.harness.behavior.runCli([...args, "--json"])).exitCode,
        1,
      );
    assert.equal(
      await h.harness.behavior.callRpc("tests.get", { id: "missing" }),
      null,
    );
    assert.equal(
      await h.harness.behavior.callRpc("calibration.get", { id: "synthetic" }),
      null,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("report persistence failure suppresses successful test output and any calibration", async (t) => {
  const h = await setup();
  try {
    t.mock.method(h.repository.evaluations, "saveReport", () => {
      throw new PersistenceError();
    });
    await assert.rejects(
      h.harness.behavior.callRpc("test", { id: "synthetic" }),
      /persistence_failed/,
    );
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    assert.equal(
      (
        h.bb.storage
          .database()
          .prepare("SELECT COUNT(*) AS n FROM evaluation_reports")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(h.repository.listRuns().length, 4); // Individual attempts remain truthful; no report success is returned.
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
