import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  fixtureHostOptions,
  setupRunner,
  question,
  definition,
} from "./runner-fixtures.ts";
import {
  evaluationDefinition,
  recordedEvaluation,
} from "./evaluation-fixtures.ts";
import { CACHE_TTL_MS } from "./response-cache.ts";
import { parseVerdict } from "./results.ts";

const input = {
  state: { text: "PRIVATE_SYNTHETIC_STATE" },
  questions: question,
  model: "private",
};
const count = (h: Awaited<ReturnType<typeof setup>>) =>
  (
    h.bb.storage
      .database()
      .prepare("SELECT COUNT(*) AS n FROM cache")
      .get() as { n: number }
  ).n;
async function setup(fetcher?: typeof fetch) {
  return setupRunner(createFakePluginHost(fixtureHostOptions), fetcher);
}

test("whole-request hits preserve typed provider identity, record every attempt and omit state/keys/question text", async () => {
  const h = await setup();
  try {
    const first = await h.api.asks.ask(input);
    const second = parseVerdict(await h.harness.behavior.callRpc("ask", input));
    assert.notEqual(first.runId, second.runId);
    assert.equal(first.steps.main?.status, "ran");
    assert.equal(second.steps.main?.status, "ran");
    if (
      first.steps.main?.status !== "ran" ||
      second.steps.main?.status !== "ran"
    )
      throw new Error("fixture");
    assert.equal(first.steps.main.cacheHit, false);
    assert.equal(second.steps.main.cacheHit, true);
    assert.deepEqual(second.steps.main.answers, first.steps.main.answers);
    assert.equal(second.steps.main.providerModel, "fixture-version");
    assert.equal(second.steps.main.inputTokens, 0);
    assert.equal(h.bodies.length, 1);
    assert.equal(h.repository.listRuns().length, 2);
    const rows = JSON.stringify(
      h.bb.storage.database().prepare("SELECT * FROM cache").all(),
    );
    assert.ok(!rows.includes("PRIVATE_SYNTHETIC_STATE"));
    assert.ok(!rows.includes("dummy-runner-secret"));
    assert.ok(!rows.includes("synthetic evidence sufficient"));
    assert.equal(count(h), 1);
    second.steps.main.answers.q = { type: "noul", noul: 0 };
    const third = await h.api.asks.ask(input);
    assert.equal(
      third.steps.main?.status === "ran" &&
        third.steps.main.answers.q?.type === "noul" &&
        third.steps.main.answers.q.noul,
      0.9,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("canonical object order hits; any state, complete question map or model configuration change misses", async () => {
  const h = await setup();
  try {
    const first = { ...input, state: { a: 1, b: 2 } };
    await h.api.asks.ask(first);
    await h.api.asks.ask({ ...input, state: { b: 2, a: 1 } });
    assert.equal(h.bodies.length, 1);
    await h.api.asks.ask({ ...input, state: { a: 1, b: 3 } });
    await h.api.asks.ask({
      ...first,
      questions: {
        q: { ...question.q!, instructions: "Changed synthetic question" },
      },
    });
    await h.api.asks.ask({
      ...first,
      questions: { ...question, other: question.q! },
    });
    assert.equal(h.bodies.length, 4);
    h.api.models.save({
      ...h.api.models.list().find((m) => m.id === "private")!,
      timeoutMs: 1234,
    });
    assert.equal(count(h), 0);
    await h.api.asks.ask(first);
    assert.equal(h.bodies.length, 5);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("privacy is checked before lookup and a shared actual fallback keeps fresh requested-model attribution", async () => {
  const h = await setup();
  try {
    await h.api.asks.ask(input);
    const fallback = await h.api.asks.ask({ ...input, model: "public" });
    assert.equal(h.bodies.length, 1);
    assert.equal(fallback.steps.main?.status, "ran");
    if (fallback.steps.main?.status !== "ran") throw new Error("fixture");
    assert.equal(fallback.steps.main.cacheHit, true);
    assert.equal(fallback.steps.main.requestedModel, "public");
    assert.equal(fallback.steps.main.resolvedModel.id, "private");
    assert.equal(fallback.steps.main.fallbackReason, "private_not_allowed");
    h.api.models.setDefault(null, true);
    const refused = await h.api.asks.ask({ ...input, model: "public" });
    assert.equal(
      refused.steps.main?.status === "unavailable" && refused.steps.main.reason,
      "private_not_allowed",
    );
    assert.equal(h.bodies.length, 1);
    h.api.models.save({
      ...h.api.models.list().find((m) => m.id === "private")!,
      allowPrivate: false,
    });
    const revoked = await h.api.asks.ask(input);
    assert.equal(revoked.steps.main?.status, "unavailable");
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("settings rotation/removal, endpoint changes, defaults and removal retire cache", async () => {
  const h = await setup();
  try {
    await h.api.asks.ask(input);
    await h.harness.behavior.setSettings({ typesafeApiKey: "dummy-rotated" });
    assert.equal(count(h), 0);
    await h.api.asks.ask(input);
    assert.equal(h.bodies.length, 2);
    await h.harness.behavior.setSettings({ typesafeApiKey: "" });
    assert.equal(count(h), 0);
    const missing = await h.api.asks.ask(input);
    assert.equal(missing.steps.main?.status, "unavailable");
    assert.equal(h.bodies.length, 2);
    await h.harness.behavior.setSettings({
      typesafeApiKey: "dummy-restored",
      customBaseUrl: "https://fixture.invalid/one",
    });
    h.api.models.save({
      id: "local",
      connection: "custom",
      model: "fixture",
      allowPrivate: true,
    });
    await h.api.asks.ask({ ...input, model: "local" });
    await h.harness.behavior.setSettings({
      customBaseUrl: "https://fixture.invalid/two",
    });
    assert.equal(count(h), 0);
    await h.api.asks.ask({ ...input, model: "local" });
    assert.equal(h.bodies.length, 4);
    h.api.models.setDefault("private");
    assert.equal(count(h), 0);
    await h.api.asks.ask(input);
    h.api.models.remove("private");
    assert.equal(count(h), 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("TTL is exact and wall-clock rollback cannot reuse a future entry", async (t) => {
  const h = await setup();
  try {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    await h.api.asks.ask(input);
    now += CACHE_TTL_MS - 1;
    assert.equal(
      (await h.api.asks.ask(input)).steps.main?.status === "ran",
      true,
    );
    assert.equal(h.bodies.length, 1);
    now++;
    await h.api.asks.ask(input);
    assert.equal(h.bodies.length, 2);
    now--;
    await h.api.asks.ask(input);
    assert.equal(h.bodies.length, 3);
    assert.equal(count(h), 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("hits still evaluate each set's outcomes and preserve fresh run/source provenance", async () => {
  const h = await setup();
  try {
    const base = definition();
    base.steps = base.steps.slice(0, 1);
    base.outcomes = { accepted: "screen.ok" };
    h.api.sets.save(JSON.stringify({ ...base, id: "first" }));
    h.api.sets.save(
      JSON.stringify({
        ...base,
        id: "second",
        outcomes: { accepted: { not: "screen.ok" } },
      }),
    );
    const first = await h.api.runner.run({ id: "first", threadId: "thread" });
    const second = await h.api.runner.run({ id: "second", threadId: "thread" });
    assert.deepEqual(first.outcomes, { accepted: true });
    assert.deepEqual(second.outcomes, { accepted: false });
    assert.notEqual(first.runId, second.runId);
    assert.equal(
      second.steps.screen?.status === "ran" && second.steps.screen.cacheHit,
      true,
    );
    assert.equal(h.bodies.length, 1);
    assert.deepEqual(h.repository.getRun(second.runId), second);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("evaluation and connection probes always make fresh bounded requests without warming cache", async () => {
  const h = await setup(recordedEvaluation);
  try {
    const def = evaluationDefinition();
    def.cases = def.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(def));
    await h.api.runner.run({ id: "synthetic", inputs: def.cases[0]!.inputs });
    assert.equal(count(h), 2);
    const start = h.bodies.length;
    for (let i = 0; i < 2; i++) {
      const report = await h.api.evaluations.test({ id: "synthetic" });
      assert.equal(report.complete, true);
      const run = h.repository.getRun(report.variants[0]!.results[0]!.runId!)!;
      assert.ok(
        Object.values(run.steps).every(
          (s) => s.status !== "ran" || !s.cacheHit,
        ),
      );
    }
    assert.equal(h.bodies.length, start + 4);
    assert.equal(count(h), 2);
    // The separate probe uses its own response adapter below; it never consults/writes cache.
  } finally {
    await h.harness.lifecycle.dispose();
  }
  const probe = await setup();
  try {
    for (let i = 0; i < 2; i++)
      assert.equal((await probe.api.check("public", true)).status, "reachable");
    assert.equal(probe.bodies.length, 2);
    assert.equal(count(probe), 0);
  } finally {
    await probe.harness.lifecycle.dispose();
  }
});
