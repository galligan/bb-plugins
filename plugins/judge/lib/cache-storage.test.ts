import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import {
  cacheDescriptor,
  CACHE_ENTRIES,
  CACHE_TTL_MS,
} from "./response-cache.ts";
import {
  question,
  fixtureHostOptions,
  setupRunner,
} from "./runner-fixtures.ts";
import { createModelService } from "./models.ts";
import { JudgeApi } from "./api.ts";
import { parseRequest, parseResponse, type Questions } from "./contracts.ts";
import type { Json } from "./json.ts";

const result = {
  status: "ran",
  providerModel: "fixture-version",
  answers: { q: { type: "noul", noul: 0.9 } },
  inputTokens: 2,
  latencyMs: 1,
} as const;
const request = (state: Json = null) =>
  cacheDescriptor("a".repeat(64), false, question, state);
test("cache caps entries and prunes expired/future rows atomically with insertion", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const { cache } = openJudgeStorage(bb.storage);
    const db = bb.storage.database();
    for (let i = 0; i < CACHE_ENTRIES + 2; i++)
      cache.put(request(i), question, result, 100000 + i);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM cache").get() as { n: number }).n,
      CACHE_ENTRIES,
    );
    assert.equal(cache.get(request(0), question, 102000), null);
    assert.equal(
      cache.get(request(1001), question, 102000)?.model,
      "fixture-version",
    );
    const before = db.prepare("SELECT * FROM cache ORDER BY key").all();
    db.exec(
      "CREATE TRIGGER fail_prune BEFORE DELETE ON cache BEGIN SELECT RAISE(ABORT, 'dummy-private-detail'); END;",
    );
    assert.throws(
      () => cache.put(request("new"), question, result, 200000),
      PersistenceError,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM cache ORDER BY key").all(),
      before,
    );
    db.exec("DROP TRIGGER fail_prune");
    cache.put(request("new"), question, result, 200000);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM cache").get() as { n: number }).n,
      1,
    );
    assert.equal(
      cache.get(request("new"), question, 200000 + CACHE_TTL_MS),
      null,
    );
    cache.put(request("clock-back"), question, result, 150000);
    assert.equal(cache.get(request("new"), question, 150000), null);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM cache").get() as { n: number }).n,
      1,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("cache read validates entire batch, descriptor, diagnostic hashes and lossless typed answers", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    const db = bb.storage.database();
    const descriptor = request();
    repo.cache.put(descriptor, question, result);
    const row = db
      .prepare("SELECT response_json FROM cache WHERE key = ?")
      .get(descriptor.key) as { response_json: string };
    const original = JSON.parse(row.response_json);
    const corruptions = [
      {
        ...original,
        descriptor: { ...original.descriptor, stateHash: "b".repeat(64) },
      },
      { ...original, questionHashes: { q: "b".repeat(64) } },
      { ...original, answers: {} },
      { ...original, answers: { q: { type: "noul", noul: 2 } } },
      {
        ...original,
        answers: {
          q: { type: "noul", noul: 0.9 },
          extra: { type: "noul", noul: 0.8 },
        },
      },
      { ...original, state: "dummy-private-corruption" },
    ];
    for (const corrupt of corruptions) {
      db.prepare("UPDATE cache SET response_json = ? WHERE key = ?").run(
        JSON.stringify(corrupt),
        descriptor.key,
      );
      assert.throws(
        () => repo.cache.get(descriptor, question),
        PersistenceError,
      );
    }
    assert.notEqual(
      cacheDescriptor("a".repeat(64), true, question, null).key,
      descriptor.key,
    );
    db.prepare(
      "UPDATE cache SET response_json = ?, created_at = -1 WHERE key = ?",
    ).run(row.response_json, descriptor.key);
    assert.throws(() => repo.cache.get(descriptor, question), PersistenceError);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("every transport-accepted nested score rubric survives cache roundtrip", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const { cache } = openJudgeStorage(bb.storage);
    let accepted = 0;
    for (let depth = 0; depth <= 16; depth++) {
      let nested: Json = "fixture-rubric";
      for (let i = 0; i < depth; i++) nested = { child: nested };
      const questions: Questions = {
        q: { type: "score", instructions: "fixture", criteria: [nested, null] },
      };
      const response = {
        model: "fixture",
        answers: {
          q: {
            type: "score",
            score: 0.25,
            confidence: 0.75,
            legend: { "0": nested, "1": null },
            probabilities: { "0": 0.75, "1": 0.25 },
          },
        },
      };
      let parsed;
      try {
        parseRequest({ model: "fixture", questions, state: null });
        parsed = parseResponse(response, questions);
      } catch {
        continue;
      }
      accepted++;
      const descriptor = cacheDescriptor(
        "a".repeat(64),
        false,
        questions,
        null,
      );
      cache.put(descriptor, questions, {
        status: "ran",
        providerModel: parsed.model,
        answers: parsed.answers,
        inputTokens: null,
        latencyMs: 1,
      });
      assert.deepEqual(
        cache.get(descriptor, questions)?.answers,
        parsed.answers,
        `depth ${depth}`,
      );
    }
    assert.ok(accepted > 8);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("fake-host reload clears responses while preserving model settings and run history", async () => {
  const h = await setupRunner(createFakePluginHost(fixtureHostOptions));
  let lifecycle = h.harness.lifecycle;
  try {
    const input = { state: null, questions: question, model: "private" };
    const first = await h.api.asks.ask(input);
    assert.equal(
      (
        h.bb.storage
          .database()
          .prepare("SELECT COUNT(*) AS n FROM cache")
          .get() as { n: number }
      ).n,
      1,
    );
    let api = h.api;
    let calls = 0;
    const fresh = await lifecycle.reload(async (next) => {
      const repository = openJudgeStorage(next.storage);
      api = new JudgeApi(
        await createModelService(next, repository),
        repository,
        next.sdk,
        async () => {
          calls++;
          return Response.json({
            model: "fixture-version",
            answers: result.answers,
          });
        },
      );
      next.onDispose(() => api.dispose());
    });
    lifecycle = fresh.harness.lifecycle;
    assert.equal(
      (
        fresh.bb.storage
          .database()
          .prepare("SELECT COUNT(*) AS n FROM cache")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.ok(api.models.list().find((m) => m.id === "private"));
    assert.ok(api.repository.getRun(first.runId));
    const second = await api.asks.ask(input);
    assert.equal(calls, 1);
    assert.equal(
      second.steps.main?.status === "ran" && second.steps.main.cacheHit,
      false,
    );
  } finally {
    await lifecycle.dispose();
  }
});
