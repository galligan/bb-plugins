import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRequest, parseResponse, modelConfigSchema } from "./contracts.ts";
import { assertJson, canonicalJson, hashJson, LIMITS } from "./json.ts";
import { parseVerdict } from "./results.ts";

const request = {
  model: "fixture",
  state: { text: "public fixture" },
  questions: {
    yes: {
      type: "noul",
      instructions: { question: "Is this text?", fields: ["text"] },
    },
    route: {
      type: "choice",
      instructions: "Which route?",
      criteria: { a: "A", b: null },
    },
    impact: {
      type: "score",
      instructions: "Impact?",
      criteria: ["low", "high"],
    },
  },
};
const response = {
  model: "fixture-1",
  answers: {
    yes: { type: "noul", noul: 0.75 },
    route: {
      type: "choice",
      choice: "a",
      confidence: 0.4,
      probabilities: { a: 0.7, b: 0.3 },
    },
    impact: {
      type: "score",
      score: 0.25,
      confidence: 0.8,
      legend: { "0": "low", "1": "high" },
      probabilities: { "0": 0.75, "1": 0.25 },
    },
  },
};

test("all typed primitives preserve structured instructions, fractional scores and missing usage", () => {
  const parsed = parseRequest(request);
  const result = parseResponse(response, parsed.questions);
  assert.equal(result.inputTokens, null);
  assert.equal(
    result.answers.impact?.type === "score" && result.answers.impact.score,
    0.25,
  );
  assert.equal(
    parseResponse(
      { ...response, usage: { input_tokens: 19 } },
      parsed.questions,
    ).inputTokens,
    19,
  );
  assert.deepEqual(
    parsed.questions.yes?.instructions,
    request.questions.yes.instructions,
  );
});

test("responses must match every submitted ID, type, option, rubric and valid distribution", () => {
  const questions = parseRequest(request).questions;
  const invalid: unknown[] = [
    { ...response, unknown: true },
    {
      ...response,
      answers: { ...response.answers, extra: { type: "noul", noul: 1 } },
    },
    { ...response, answers: { yes: response.answers.yes } },
    { ...response, usage: { input_tokens: -1 } },
    { ...response, usage: { input_tokens: 2, secret: "should reject" } },
  ];
  for (const noul of [NaN, Infinity, -0.1, 1.1, "0.5"])
    invalid.push({
      ...response,
      answers: { ...response.answers, yes: { type: "noul", noul } },
    });
  for (const change of [
    { type: "noul", noul: 0.5 },
    { ...response.answers.route, choice: "unknown" },
    { ...response.answers.route, confidence: 2 },
    { ...response.answers.route, probabilities: { a: 0.1, b: 0.1 } },
    { ...response.answers.route, probabilities: { a: 0.1, b: 0.9 } },
    { ...response.answers.route, probabilities: { a: 0.7, c: 0.3 } },
  ])
    invalid.push({
      ...response,
      answers: { ...response.answers, route: change },
    });
  for (const change of [
    { ...response.answers.impact, score: 1.1 },
    { ...response.answers.impact, score: 0.5 },
    { ...response.answers.impact, probabilities: { "0": 0.75, "2": 0.25 } },
    { ...response.answers.impact, legend: { "0": "wrong", "1": "high" } },
  ])
    invalid.push({
      ...response,
      answers: { ...response.answers, impact: change },
    });
  for (const value of invalid)
    assert.throws(() => parseResponse(value, questions));
});

test("strict questions and model config reject unsupported fields, types and secret-bearing records", () => {
  for (const question of [
    { type: "image", instructions: "image" },
    { type: "noul", instructions: "Q", extra: true },
    { type: "choice", instructions: "Q", criteria: { a: null } },
    { type: "score", instructions: "Q", criteria: ["one"] },
    { type: "score", instructions: "Q", criteria: Array(11).fill("level") },
    { type: "noul", instructions: 5 },
  ])
    assert.throws(() =>
      parseRequest({ ...request, questions: { q: question } }),
    );
  assert.throws(() => parseRequest({ ...request, private: false }));
  assert.throws(() =>
    modelConfigSchema.parse({
      id: "test",
      connection: "typesafe",
      model: "x",
      apiKey: "dummy",
    }),
  );
  assert.equal(
    modelConfigSchema.parse({ id: "test", connection: "typesafe", model: "x" })
      .allowPrivate,
    false,
  );
  assert.throws(() =>
    modelConfigSchema.parse({
      id: "test",
      connection: "typesafe",
      model: "x",
      timeoutMs: 30001,
    }),
  );
});

test("JSON rejects lossy serialization, deep/cyclic values, accessors and UTF-8 oversized inputs", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const getter = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      throw new Error("must not read accessor");
    },
  });
  let deep: unknown = "leaf";
  for (let i = 0; i < 18; i++) deep = { next: deep };
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    new Map(),
    () => 1,
    { x: undefined },
    [undefined],
    Array(2),
    cycle,
    getter,
    deep,
    { [Symbol("key")]: 1 },
  ]) {
    assert.throws(() => assertJson(value));
  }
  assert.throws(
    () =>
      parseRequest({
        ...request,
        state: { text: "é".repeat(LIMITS.inputBytes / 2) },
      }),
    /too_large/,
  );
  assert.throws(() =>
    parseRequest({
      ...request,
      questions: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`q${i}`, request.questions.yes]),
      ),
    }),
  );
  assert.throws(() =>
    parseRequest({
      ...request,
      state: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`i${i}`, "x"]),
      ),
    }),
  );
  assert.throws(
    () =>
      parseRequest({
        ...request,
        questions: {
          q: { type: "noul", instructions: "x".repeat(LIMITS.requestBytes) },
        },
      }),
    /too_large/,
  );
  assert.throws(
    () =>
      parseResponse(
        { ...response, model: "x".repeat(LIMITS.responseBytes) },
        parseRequest(request).questions,
      ),
    /too_large/,
  );
});

test("canonical hashes ignore map insertion order and preserve array order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: [true, null] }),
    '{"a":[true,null],"z":1}',
  );
  assert.equal(hashJson({ z: 1, a: 2 }), hashJson({ a: 2, z: 1 }));
  assert.notEqual(hashJson([1, 2]), hashJson([2, 1]));
});

test("verdicts distinguish ad hoc/saved identities and do not turn missing evidence into complete outcomes", () => {
  const base = {
    runId: "run1",
    set: null,
    threadId: null,
    projectId: null,
    startedAt: 1,
    endedAt: 2,
    complete: false,
    calibrated: false,
    steps: {
      main: {
        status: "unavailable",
        reason: "not_configured",
        code: "missing_model",
      },
    },
    outcomes: {},
  };
  assert.equal(parseVerdict(base).set, null);
  assert.throws(() => parseVerdict({ ...base, complete: true }));
  assert.throws(() => parseVerdict({ ...base, outcomes: { action: true } }));
  assert.throws(() => parseVerdict({ ...base, calibrated: true }));
  assert.throws(() => parseVerdict({ ...base, state: "must not persist" }));
  assert.throws(() =>
    parseVerdict({ ...base, steps: { second: base.steps.main } }),
  );
  assert.equal(
    parseVerdict({
      ...base,
      set: { id: "saved", scope: "global", hash: "a".repeat(64) },
      steps: { first: base.steps.main },
    }).set?.id,
    "saved",
  );
  assert.throws(() =>
    parseVerdict({
      ...base,
      steps: { main: { status: "unavailable", reason: "made_up", code: "x" } },
    }),
  );
});
