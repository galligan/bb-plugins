import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { parseRequest, parseResponse, type Answers } from "./contracts.ts";
import { parseVerdict } from "./results.ts";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import type { Json } from "./json.ts";

function verdict(answers: unknown) {
  const now = Date.now();
  return {
    runId: "boundary",
    set: null,
    threadId: null,
    projectId: null,
    startedAt: now,
    endedAt: now,
    complete: true,
    calibrated: false,
    steps: {
      main: {
        status: "ran",
        requestedModel: "fixture",
        resolvedModel: {
          id: "fixture",
          connection: "typesafe",
          model: "fixture1",
          fingerprint: "a".repeat(64),
        },
        fallbackReason: null,
        answers,
        outcomes: {},
        latencyMs: 1,
        inputTokens: null,
        cacheHit: false,
        provenance: {},
      },
    },
    outcomes: {},
  };
}

test("invalid self-contained answers fail verdict validation and storage, including corrupt readback", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    const invalid = [
      {
        type: "choice",
        choice: "absent",
        confidence: 0.5,
        probabilities: { a: 0.5, b: 0.5 },
      },
      {
        type: "choice",
        choice: "a",
        confidence: 0.5,
        probabilities: { a: 0.1, b: 0.9 },
      },
      {
        type: "score",
        score: 999,
        confidence: 0.5,
        legend: { "0": "low", "1": "high" },
        probabilities: { "0": 1 },
      },
      {
        type: "score",
        score: 0.5,
        confidence: 0.5,
        legend: { "0": "low", "1": "high" },
        probabilities: { "0": 0.75, "1": 0.25 },
      },
      {
        type: "score",
        score: 1,
        confidence: 0.5,
        legend: { "0": "low", "2": "high" },
        probabilities: { "0": 0.5, "2": 0.5 },
      },
    ];
    for (const answer of invalid) {
      assert.throws(() => parseVerdict(verdict({ q: answer })));
      assert.throws(() => repo.saveRun(verdict({ q: answer })));
      assert.equal(repo.getRun("boundary"), null);
    }
    const good = repo.saveRun(verdict({ q: { type: "noul", noul: 0.7 } }));
    for (const answer of invalid) {
      bb.storage
        .database()
        .prepare("UPDATE steps SET result_json = ? WHERE run_id = ?")
        .run(
          JSON.stringify({ ...good.steps.main, answers: { q: answer } }),
          good.runId,
        );
      assert.throws(() => repo.getRun(good.runId), PersistenceError);
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("all accepted structured rubric depths survive verdict save/reload", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    for (let depth = 0; depth <= 12; depth++) {
      let level: Json = "low";
      for (let i = 0; i < depth; i++) level = { nested: level };
      const request = parseRequest({
        model: "fixture",
        state: null,
        questions: {
          q: {
            type: "score",
            instructions: "Score",
            criteria: [level, "high"],
          },
        },
      });
      const response = parseResponse(
        {
          model: "fixture",
          answers: {
            q: {
              type: "score",
              score: 0.25,
              confidence: 0.5,
              legend: { "0": level, "1": "high" },
              probabilities: { "0": 0.75, "1": 0.25 },
            },
          },
        },
        request.questions,
      );
      const result = repo.saveRun({
        ...verdict(response.answers),
        runId: `depth${depth}`,
      });
      assert.deepEqual(repo.getRun(result.runId), result);
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("dynamic maps either preserve reserved JSON keys or explicitly reject them", () => {
  const criteria = JSON.parse('{"__proto__":"P","a":"A","b":"B"}');
  assert.throws(
    () =>
      parseRequest({
        model: "fixture",
        state: null,
        questions: { q: { type: "choice", instructions: "Pick", criteria } },
      }),
    /unsupported_json_key/,
  );
  const request = parseRequest({
    model: "fixture",
    state: JSON.parse('{"__proto__":"state is preserved"}'),
    questions: {
      q: { type: "choice", instructions: "Pick", criteria: { a: "A", b: "B" } },
    },
  });
  assert.deepEqual(Object.keys(request.state!), ["__proto__"]);
  const answer = {
    type: "choice",
    choice: "a",
    confidence: 0.5,
    probabilities: JSON.parse('{"__proto__":0,"a":0.7,"b":0.3}'),
  };
  assert.throws(
    () =>
      parseResponse(
        { model: "fixture", answers: { q: answer } },
        request.questions,
      ),
    /unsupported_json_key/,
  );
  assert.throws(
    () => parseVerdict(verdict({ q: answer })),
    /unsupported_json_key/,
  );
});

test("saved-set step execution order survives persistence even when IDs sort differently", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    const v = verdict({ q: { type: "noul", noul: 0.5 } } satisfies Answers);
    repo.saveRun({
      ...v,
      set: { id: "saved", hash: "a".repeat(64), scope: "global" },
      steps: { prepare: v.steps.main, analyze: v.steps.main },
    });
    assert.deepEqual(Object.keys(repo.getRun(v.runId)!.steps), [
      "prepare",
      "analyze",
    ]);
    assert.deepEqual(Object.keys(repo.listRuns()[0]!.steps), [
      "prepare",
      "analyze",
    ]);
  } finally {
    await harness.lifecycle.dispose();
  }
});
