import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { setupTriggers, triggerHostOptions } from "./trigger-fixtures.ts";
import { parseMetadata } from "./verdict-metadata.ts";
import { LIMITS } from "./json.ts";
import { Deadline } from "./deadline.ts";
import { snapshot, idleEvent } from "./trigger-events.ts";
const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
async function setup() {
  const controls = triggerHostOptions(thread);
  return setupTriggers(createFakePluginHost(controls.options), controls);
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check());
}

test("failed clearing is visible without erasing the verdict and later cleanup records recovery", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const first = h.repository.triggerAttempts.list({}).attempts[0]!;
    h.setWriteFailure(true);
    h.triggers.enable("binding", false);
    await until(
      () =>
        h.repository.triggerAttempts.get(first.runId)?.publication === "failed",
    );
    assert.equal(
      h.repository.triggerAttempts.get(first.runId)?.code,
      "metadata_clear_failed",
    );
    assert.equal(h.repository.getRun(first.runId)?.complete, true);
    const read = await h.api.verdicts.keyed({ threadIds: ["thread"] });
    assert.equal(read.threads[0]?.summaries.length, 0);
    assert.equal(read.threads[0]?.publicationFailure, "metadata_clear_failed");
    h.setWriteFailure(false);
    h.publisher.reconcile();
    await until(
      () =>
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(
      h.repository.triggerAttempts.get(first.runId)?.publication,
      "cleared",
    );
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("older cleanup cannot acknowledge, erase or invalidate a newer reference created during its SDK read", async () => {
  const h = await setup();
  let release = () => {};
  let enter = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  try {
    const trigger = h.enable();
    await h.engine.idle(h.idle());
    const original = h.options.sdk.threads.getPluginMetadata;
    h.harness.sdk.stub("threads.getPluginMetadata", async (args) => {
      const value = await original(args);
      if (first) {
        first = false;
        enter();
        await held;
      }
      return value;
    });
    h.publisher.invalidateSet("thread", "event-set");
    await entered;
    const run = await h.api.runner.run({
      id: "event-set",
      threadId: "thread",
      inputs: { main: { reply: "NEW_SYNTHETIC_TEXT" } },
    });
    assert.equal(run.calibrated, true);
    h.repository.triggerAttempts.save({
      runId: run.runId,
      triggerId: "binding",
      event: "thread.idle",
      eventHash: "c".repeat(64),
      startedAt: run.startedAt,
      decision: "ran",
      publication: "none",
      code: null,
    });
    const scope = new Deadline({ deadlineAt: performance.now() + 5000 });
    const before = await snapshot(h.bb.sdk, idleEvent(h.idle()), scope);
    scope.close();
    await h.publisher.publish(run, trigger, before.snapshot);
    release();
    await until(
      () =>
        h.repository.publications.forThread("thread")[0]?.published === true &&
        parseMetadata(h.metadata.get("thread")).verdicts.summaries[0]?.runId ===
          run.runId,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      h.repository.publications.forThread("thread")[0]?.runId,
      run.runId,
    );
    assert.equal(
      parseMetadata(h.metadata.get("thread")).verdicts.summaries[0]?.runId,
      run.runId,
    );
    assert.equal(
      h.repository.triggerAttempts.get(run.runId)?.publication,
      "published",
    );
  } finally {
    release();
    await h.harness.lifecycle.dispose();
  }
});

test("explicit reacceptance clears older displays without changing model generation or starting inference", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const accepted = h.repository.evaluations.getAcceptance("event-set")!;
    const generation = h.api.models.configurationGeneration();
    await h.api.calibration.accept("event-set", accepted.testRunId);
    await until(
      () =>
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(h.api.models.configurationGeneration(), generation);
    assert.equal(h.bodies.length, 1);
    assert.equal(
      h.repository.triggerAttempts.list({}).attempts[0]?.publication,
      "cleared",
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("evaluation retention retires linked badges through a post-commit notification without invalidating the new report", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const accepted = h.repository.evaluations.getAcceptance("event-set")!;
    const report = h.repository.evaluations.getReport(accepted.testRunId)!;
    const generation = h.api.models.configurationGeneration();
    const now = report.startedAt + LIMITS.runAgeMs + 1;
    h.repository.evaluations.saveReport(
      { ...report, id: "retention-fixture", startedAt: now, endedAt: now + 1 },
      now,
    );
    await until(
      () =>
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(h.repository.evaluations.getAcceptance("event-set"), null);
    assert.ok(h.repository.evaluations.getReport("retention-fixture"));
    assert.equal(h.api.models.configurationGeneration(), generation);
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
