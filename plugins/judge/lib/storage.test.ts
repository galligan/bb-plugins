import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import { openJudgeStorage, PersistenceError } from "./storage.ts";

const model = { id: "fixture", connection: "typesafe", model: "fixture-model" };
function run(id: string, startedAt = Date.now()) {
  return {
    runId: id,
    set: null,
    threadId: "thread1",
    projectId: "project1",
    startedAt,
    endedAt: startedAt + 1,
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
}

test("fresh real SQLite database, idempotent migrations, reload persistence and stale handle failure", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    assert.deepEqual(repo.listModels(), []);
    repo.saveModel(model);
    repo.saveRun(run("run1"));
    openJudgeStorage(bb.storage);
    assert.equal(repo.getRun("run1")?.steps.main?.status, "unavailable");
    let after = repo;
    await harness.lifecycle.reload((next) => {
      after = openJudgeStorage(next.storage);
    });
    assert.equal(after.listModels()[0]?.model, "fixture-model");
    assert.equal(after.getRun("run1")?.set, null);
    assert.throws(() => repo.listModels(), PersistenceError);
    assert.equal(after.listRuns({ threadId: "other" }).length, 0);
    assert.equal(after.listRuns({ threadId: "thread1" }).length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("run plus steps roll back atomically when a step insert fails; no raw failure body escapes", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    bb.storage
      .database()
      .exec(
        "CREATE TRIGGER fail_step BEFORE INSERT ON steps BEGIN SELECT RAISE(ABORT, 'sensitive upstream detail'); END",
      );
    assert.throws(
      () => repo.saveRun(run("partial")),
      (error: unknown) =>
        error instanceof PersistenceError &&
        error.message === "persistence_failed",
    );
    assert.equal(repo.getRun("partial"), null);
    assert.equal(
      bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM steps")
        .get()?.n,
      0,
    );
    bb.storage.database().exec("DROP TRIGGER fail_step");
    repo.saveRun(run("partial"));
    assert.throws(() => repo.saveRun(run("partial")), PersistenceError);
    assert.equal(repo.listRuns().length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("validation precedes writes; persisted rows contain no request state or credentials", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    assert.throws(() => repo.saveModel({ ...model, apiKey: "dummy" }));
    assert.throws(() =>
      repo.saveRun({ ...run("bad"), state: "private input" }),
    );
    assert.equal(repo.listModels().length, 0);
    assert.equal(repo.listRuns().length, 0);
    repo.saveModel(model);
    repo.saveRun(run("good"));
    const text = JSON.stringify(
      bb.storage.database().prepare("SELECT * FROM runs").all(),
    );
    assert.ok(!text.includes("private input") && !text.includes("apiKey"));
    assert.throws(() => repo.listRuns({ limit: 101 }), RangeError);
    bb.storage
      .database()
      .prepare("UPDATE models SET config_json = ?")
      .run('{"apiKey":"dummy"}');
    assert.throws(() => repo.listModels(), PersistenceError);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("retention deletes old runs with their dependent steps and caps run count", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    repo.saveRun(run("old", 1), 1);
    repo.saveRun(
      run("new", 40 * 24 * 60 * 60 * 1000),
      40 * 24 * 60 * 60 * 1000,
    );
    assert.equal(repo.getRun("old"), null);
    assert.equal(
      bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM steps")
        .get()?.n,
      1,
    );
    const now = Date.now();
    bb.storage.database().transaction(() => {
      const insert = bb.storage
        .database()
        .prepare(
          "INSERT INTO runs(id, started_at, summary_json) VALUES (?, ?, '{}')",
        );
      for (let i = 0; i < 10_005; i++) insert.run(`seed${i}`, now - i - 1);
    })();
    repo.saveRun(run("latest", now), now);
    assert.equal(
      bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM runs")
        .get()?.n,
      10000,
    );
    assert.equal(repo.getRun("latest")?.runId, "latest");
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("migration failures are operational errors and appended statements roll back", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const db = bb.storage.database();
    assert.throws(() =>
      bb.storage.migrate(db, [
        "CREATE TABLE atomic_test(id TEXT)",
        "INVALID SQL",
      ]),
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'atomic_test'")
        .get(),
      undefined,
    );
    assert.throws(
      () =>
        openJudgeStorage({
          ...bb.storage,
          migrate() {
            throw new Error("private disk path");
          },
        }),
      PersistenceError,
    );
    openJudgeStorage(bb.storage);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("package imports only public SDK and declared runtime dependencies", async () => {
  const report = await experimental_scanPublicSdkOnly(
    new URL("..", import.meta.url).pathname,
    {
      allow: [
        /^zod$/,
        /^yaml$/,
        /^react(?:-dom)?(?:\/.*)?$/,
        /^vitest(?:\/config)?$/,
        /^@testing-library\/react$/,
        /^@radix-ui\/react-(?:checkbox|select|slot)$/,
        /^class-variance-authority$/,
        /^clsx$/,
        /^tailwind-merge$/,
      ],
    },
  );
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});

test("successful typed answers persist and pagination preserves timestamp ties", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    const time = Date.now();
    const value = {
      ...run("a", time),
      complete: true,
      steps: {
        main: {
          status: "ran",
          requestedModel: "fixture",
          resolvedModel: {
            id: "fixture",
            connection: "typesafe",
            model: "fixture-1",
            fingerprint: "a".repeat(64),
          },
          fallbackReason: null,
          answers: { q: { type: "noul", noul: 0.8 } },
          outcomes: { yes: true },
          latencyMs: 1.5,
          inputTokens: null,
          cacheHit: false,
          provenance: {},
        },
      },
      outcomes: { yes: true },
    };
    repo.saveRun(value);
    repo.saveRun({ ...value, runId: "b" });
    assert.deepEqual(repo.getRun("a"), value);
    const first = repo.listRuns({ limit: 1 });
    assert.equal(first[0]?.runId, "b");
    const next = repo.listRuns({
      limit: 1,
      before: { startedAt: first[0]!.startedAt, runId: first[0]!.runId },
    });
    assert.equal(next[0]?.runId, "a");
    assert.throws(() =>
      repo.saveRun({
        ...value,
        runId: "bad",
        steps: { main: { ...value.steps.main, answers: {} } },
      }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
