import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions } from "./runner-fixtures.ts";
import {
  evaluationDefinition,
  recordedEvaluation,
  setupEvaluation,
} from "./evaluation-fixtures.ts";

const setup = (fetcher?: typeof fetch) =>
  setupEvaluation(createFakePluginHost(fixtureHostOptions), fetcher);

test("pre-abort and expiry before first case report unavailable without starting case runs", async (t) => {
  const h = await setup();
  try {
    const caller = new AbortController();
    caller.abort();
    const cancelled = await h.api.evaluations.test(
      { id: "synthetic" },
      caller.signal,
    );
    assert.equal(cancelled.failure?.reason, "cancelled");
    assert.equal(cancelled.complete, false);
    assert.ok(
      cancelled.variants[0]!.results.every(
        (c) => c.runId === null && c.status === "unavailable",
      ),
    );
    let now = 1;
    t.mock.method(performance, "now", () => now);
    const current = h.api.models.configurationGeneration.bind(h.api.models);
    t.mock.method(h.api.models, "configurationGeneration", () => {
      const generation = current();
      now = 31001;
      return generation;
    });
    const expired = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(expired.failure?.reason, "budget");
    assert.equal(expired.variants[0]?.counts.unavailable, 4);
    assert.equal(h.repository.listRuns().length, 0);
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("partial evaluation retains completed cases, does not start later cases, and cannot establish calibration", async (t) => {
  const h = await setup();
  try {
    let offset = 0;
    const now = performance.now.bind(performance);
    t.mock.method(performance, "now", () => now() + offset);
    const save = h.repository.saveRun.bind(h.repository);
    t.mock.method(h.repository, "saveRun", (value: unknown) => {
      const saved = save(value);
      offset = 31000;
      return saved;
    });
    const report = await h.api.evaluations.test({
      id: "synthetic",
      compare: "private",
    });
    assert.equal(report.failure?.reason, "budget");
    assert.equal(report.complete, false);
    assert.equal(report.variants[0]?.results[0]?.status, "correct");
    assert.ok(report.variants[0]!.results[0]!.runId);
    assert.ok(
      report.variants[0]!.results.slice(1).every((c) => c.runId === null),
    );
    assert.ok(report.variants[1]!.results.every((c) => c.runId === null));
    assert.equal(report.variants[0]?.outcomes.accepted?.accuracy, 1);
    assert.equal(report.variants[0]?.outcomes.accepted?.unavailable, 3);
    assert.equal(report.variants[1]?.outcomes.accepted?.accuracy, null);
    assert.equal(h.bodies.length, 2);
    assert.equal(h.repository.listRuns().length, 1);
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("configuration edit during evaluation marks the report stale and aborts before further requests", async () => {
  let mutate: () => void = () => {};
  const h = await setup(async () => {
    mutate();
    return new Promise(() => {});
  });
  try {
    mutate = () =>
      h.api.models.save({
        id: "private",
        model: "changed-during-test",
        connection: "typesafe",
        allowPrivate: true,
      });
    const report = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(report.stale, true);
    assert.equal(report.complete, false);
    assert.equal(report.failure?.code, "configuration_changed");
    assert.equal(h.bodies.length, 1);
    assert.equal(h.repository.listRuns().length, 1);
    assert.ok(
      report.variants[0]!.results.slice(1).every((c) => c.runId === null),
    );
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("one active evaluation bounds concurrency; caller/disposal abort preserves its case record and clears busy state", async () => {
  for (const kind of ["caller", "dispose"]) {
    let enter: () => void = () => {};
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    let blocked = true;
    const h = await setup(async (url, init) => {
      if (blocked) {
        enter();
        return new Promise(() => {});
      }
      return recordedEvaluation(url, init);
    });
    const caller = new AbortController();
    try {
      const pending = h.api.evaluations.test(
        { id: "synthetic" },
        caller.signal,
      );
      await entered;
      await assert.rejects(
        h.api.evaluations.test({ id: "synthetic" }),
        /evaluation_busy/,
      );
      if (kind === "caller") caller.abort();
      else h.api.evaluations.dispose();
      const report = await pending;
      assert.equal(report.failure?.reason, "cancelled");
      assert.equal(report.complete, false);
      assert.equal(
        report.variants[0]?.results[0]?.failure?.reason,
        "cancelled",
      );
      assert.ok(report.variants[0]?.results[0]?.runId);
      assert.equal(h.repository.listRuns().length, 1);
      assert.equal(h.bodies.length, 1);
      blocked = false;
      const next = await h.api.evaluations.test({ id: "synthetic" });
      assert.equal(
        next.failure?.reason,
        kind === "dispose" ? "cancelled" : undefined,
      );
      assert.equal(h.bodies.length, kind === "dispose" ? 1 : 7);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("expiry during final report validation preserves completed case evidence but refuses acceptance", async (t) => {
  const h = await setup();
  try {
    const definition = evaluationDefinition();
    definition.cases = definition.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(definition));
    let armed = false;
    let offset = 0;
    const saveRun = h.repository.saveRun.bind(h.repository);
    t.mock.method(
      h.repository,
      "saveRun",
      (...args: Parameters<typeof saveRun>) => {
        const value = saveRun(...args);
        armed = true;
        return value;
      },
    );
    const now = performance.now.bind(performance);
    const date = Date.now.bind(Date);
    t.mock.method(performance, "now", () => now() + offset);
    t.mock.method(Date, "now", () => {
      if (armed) {
        offset = 31000;
        armed = false;
      }
      return date();
    });
    const report = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(report.complete, false);
    assert.equal(report.failure?.reason, "budget");
    assert.equal(report.variants[0]?.results[0]?.status, "correct");
    assert.deepEqual(report.variants[0]?.steps, {
      ran: 2,
      skipped: 0,
      unavailable: 0,
    });
    assert.equal(report.variants[0]?.counts.correct, 1);
    assert.equal(h.bodies.length, 2);
    await assert.rejects(h.api.calibration.accept("synthetic", report.id));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("definitions with no cases and invalid arguments are refused before any model request", async () => {
  const h = await setup();
  try {
    h.api.sets.save(JSON.stringify({ ...evaluationDefinition(), cases: [] }));
    await assert.rejects(
      h.api.evaluations.test({ id: "synthetic" }),
      /cases_required/,
    );
    await assert.rejects(
      h.api.evaluations.test({ id: "missing" }),
      /missing_set/,
    );
    await assert.rejects(
      h.harness.behavior.callRpc("test", {
        id: "synthetic",
        compare: "x",
        model: "x",
      }),
    );
    await assert.rejects(
      h.harness.behavior.callRpc("test", { id: "synthetic", inputs: {} }),
    );
    assert.equal(h.bodies.length, 0);
    assert.equal(h.repository.listRuns().length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
