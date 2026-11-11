import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import {
  triggerHostOptions,
  setupTriggers,
  triggerDefinition as definition,
} from "./trigger-fixtures.ts";
import { parseMetadata } from "./verdict-metadata.ts";
const base = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
async function setup(fetcher?: typeof fetch) {
  const controls = triggerHostOptions(base);
  const h = await setupTriggers(
    createFakePluginHost(controls.options),
    controls,
    fetcher,
  );
  return { ...h, dispose: () => h.harness.lifecycle.dispose() };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check());
}

test("disabled bindings make no SDK/provider calls; enabled current calibrated idle evidence publishes without old-output fallback", async () => {
  const h = await setup();
  try {
    h.triggers.save({
      id: "binding",
      setId: "event-set",
      event: "thread.idle",
      badges: { accepted: "Synthetic verdict" },
    });
    const calls = h.harness.inspection.sdk.calls.length;
    await h.engine.idle(h.idle());
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, calls);
    h.triggers.enable("binding", true);
    await h.engine.idle(h.idle());
    assert.equal(h.bodies.length, 1);
    assert.equal(h.outputs(), 0);
    assert.equal(
      h.bodies[0]?.state !== null &&
        JSON.stringify(h.bodies[0]?.state).includes("SYNTHETIC_CURRENT_REPLY"),
      true,
    );
    const attempts = h.repository.triggerAttempts.list({}).attempts;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.publication, "published");
    assert.equal(
      parseMetadata(h.metadata.get("thread")).verdicts.summaries[0]?.badges[0]
        ?.label,
      "Synthetic verdict",
    );
    h.threads.set("thread", { ...h.current("thread"), updatedAt: 1001 });
    await h.engine.idle(h.idle("thread", null));
    assert.equal(h.bodies.length, 1);
    assert.equal(h.outputs(), 0);
    await until(
      () =>
        parseMetadata(h.metadata.get("thread")).verdicts.summaries.length === 0,
    );
    assert.equal(h.repository.triggerAttempts.list({}).attempts.length, 2);
  } finally {
    await h.dispose();
  }
});

test("project/set/binding intersection and private-policy refusal produce records without dispatch or badges", async () => {
  const h = await setup();
  try {
    h.enable("thread.idle", ["other"]);
    await h.engine.idle(h.idle());
    assert.equal(h.bodies.length, 0);
    assert.equal(
      h.repository.triggerAttempts.list({}).attempts[0]?.decision,
      "not_applicable",
    );
    h.enable();
    h.threads.set("thread", { ...h.current("thread"), updatedAt: 1001 });
    h.api.models.save({
      ...h.api.models.list().find((m) => m.id === "private")!,
      allowPrivate: false,
    });
    await h.engine.idle(h.idle());
    assert.equal(h.bodies.length, 0);
    assert.equal(h.writes(), 0);
    assert.equal(h.repository.triggerAttempts.list({}).attempts.length, 2);
    h.api.sets.project("project", false);
    assert.equal(h.triggers.get("binding")?.enabled, false);
  } finally {
    await h.dispose();
  }
});

test("failure bindings consume only their normalized request facts and never borrow an idle message", async () => {
  const h = await setup();
  try {
    const failed = {
      threadId: "thread",
      requestId: "request-thread",
      turnId: null,
      errorInfo: { message: "PRIVATE_SYNTHETIC_FAILURE" },
      inputAccepted: false,
      attemptNumber: 1,
      originPluginId: null,
      rateLimits: null,
    };
    const def = {
      ...definition,
      inputs: { reply: { from: "event.error" } },
      cases: [
        {
          inputs: { reply: "AUTHORED_SYNTHETIC_TEXT" },
          expect: { accepted: true },
        },
      ],
    };
    h.api.sets.save(JSON.stringify(def));
    const report = await h.api.evaluations.test({ id: "event-set" });
    await h.api.calibration.accept("event-set", report.id);
    h.bodies.length = 0;
    h.threads.set("thread", { ...h.current("thread"), status: "error" });
    h.enable("turn.failed");
    await h.engine.failed(failed);
    assert.equal(h.bodies.length, 1);
    assert.ok(
      JSON.stringify(h.bodies[0]?.state).includes("PRIVATE_SYNTHETIC_FAILURE"),
    );
    assert.equal(h.outputs(), 0);
    const attempt = h.repository.triggerAttempts.list({}).attempts[0]!;
    assert.equal(attempt.event, "turn.failed");
    assert.equal(attempt.publication, "published");
    assert.ok(!JSON.stringify(attempt).includes("PRIVATE_SYNTHETIC_FAILURE"));
    assert.ok(
      !JSON.stringify(h.metadata.get("thread")).includes(
        "PRIVATE_SYNTHETIC_FAILURE",
      ),
    );
  } finally {
    await h.dispose();
  }
});

test("two-global/one-thread admission records busy and duplicate events, aborts superseded work and never queues inference", async () => {
  let hold = false;
  const releases: (() => void)[] = [];
  const h = await setup(async () => {
    if (hold) await new Promise<void>((resolve) => releases.push(resolve));
    return Response.json({
      model: "fixture",
      answers: { q: { type: "noul", noul: 0.9 } },
    });
  });
  try {
    h.enable();
    hold = true;
    const a = h.engine.idle(h.idle("a"));
    const b = h.engine.idle(h.idle("b"));
    await until(() => h.bodies.length === 2);
    await h.engine.idle(h.idle("c"));
    await h.engine.idle(h.idle("a"));
    assert.equal(h.bodies.length, 2);
    h.threads.set("a", { ...h.current("a"), updatedAt: 1001 });
    await h.engine.idle(h.idle("a"));
    assert.equal(h.bodies.length, 2);
    for (const release of releases) release();
    await Promise.all([a, b]);
    const attempts = h.repository.triggerAttempts.list({ limit: 100 }).attempts;
    assert.equal(attempts.filter((a) => a.decision === "busy").length, 2);
    assert.equal(attempts.filter((a) => a.decision === "duplicate").length, 1);
    assert.equal(attempts.length, 5);
    assert.equal(h.bodies.length, 2);
    assert.equal(h.metadata.has("a"), false);
    assert.equal(
      parseMetadata(h.metadata.get("b")).verdicts.summaries.length,
      1,
    );
  } finally {
    for (const release of releases) release();
    await h.dispose();
  }
});

test("disable/edit/remove/model/set changes and disposal abort active requests without late publication", async () => {
  for (const change of [
    "disable",
    "edit",
    "remove",
    "model",
    "set",
    "dispose",
  ]) {
    let hold = false;
    let release = () => {};
    const h = await setup(async () => {
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return Response.json({
        model: "fixture",
        answers: { q: { type: "noul", noul: 0.9 } },
      });
    });
    try {
      h.enable();
      hold = true;
      const pending = h.engine.idle(h.idle());
      await until(() => h.bodies.length === 1);
      if (change === "disable") h.triggers.enable("binding", false);
      if (change === "edit")
        h.triggers.save({
          id: "binding",
          setId: "event-set",
          event: "thread.idle",
          badges: { accepted: "Edited" },
        });
      if (change === "remove") h.triggers.remove("binding");
      if (change === "model")
        h.api.models.save({
          ...h.api.models.list().find((m) => m.id === "private")!,
          timeoutMs: 1234,
        });
      if (change === "set")
        h.api.sets.save(
          JSON.stringify({
            ...definition,
            description: "Changed synthetic definition",
          }),
        );
      if (change === "dispose") h.engine.dispose();
      await pending;
      release();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.writes(), 0, change);
      assert.equal(h.bodies.length, 1, change);
      assert.equal(h.repository.triggerAttempts.list({}).attempts.length, 1);
    } finally {
      release();
      await h.dispose();
    }
  }
});
