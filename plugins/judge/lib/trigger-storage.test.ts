import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  openJudgeStorage,
  JudgeRepository,
  MIGRATIONS,
  PersistenceError,
} from "./storage.ts";
import { LIMITS } from "./json.ts";
import type { Verdict } from "./results.ts";
import type { VerdictSummary } from "./verdict-metadata.ts";
import type { TriggerSnapshot } from "./trigger-events.ts";
const stamp: TriggerSnapshot = {
  thread: {
    id: "thread",
    projectId: "project",
    environmentId: null,
    updatedAt: 1000,
    status: "idle",
    archivedAt: null,
    deletedAt: null,
  },
  sequence: 10,
  requestId: null,
};
function run(id: string, startedAt: number): Verdict {
  return {
    runId: id,
    set: { id: `set-${id}`, scope: "global", hash: "a".repeat(64) },
    threadId: "thread",
    projectId: "project",
    startedAt,
    endedAt: startedAt,
    complete: true,
    calibrated: true,
    steps: {
      main: {
        status: "ran",
        requestedModel: "fixture",
        resolvedModel: {
          id: "fixture",
          connection: "typesafe",
          model: "fixture",
          fingerprint: "a".repeat(64),
        },
        providerModel: "fixture",
        fallbackReason: null,
        answers: { q: { type: "noul", noul: 0.9 } },
        outcomes: { ok: true },
        latencyMs: 1,
        inputTokens: 1,
        cacheHit: false,
        provenance: {},
      },
    },
    outcomes: { accepted: true },
  };
}
function summary(value: Verdict): VerdictSummary {
  return {
    runId: value.runId,
    setId: value.set!.id,
    setHash: value.set!.hash,
    triggerId: "binding",
    triggerRevision: "revision",
    timestamp: value.startedAt,
    outcomes: value.outcomes,
    complete: true,
    calibrated: true,
    badges: [{ outcome: "accepted", label: "Fixture" }],
  };
}
function attempt(value: Verdict) {
  return {
    runId: value.runId,
    triggerId: "binding",
    event: "thread.idle" as const,
    eventHash: "b".repeat(64),
    startedAt: value.startedAt,
    decision: "ran" as const,
    publication: "none" as const,
    code: null,
  };
}

test("appended trigger/publication migrations preserve a populated previous schema and ordered history", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const db = bb.storage.database();
    db.pragma("foreign_keys = ON");
    bb.storage.migrate(db, MIGRATIONS.slice(0, 13));
    const legacy = new JudgeRepository(db);
    const before = run("legacy", Date.now());
    legacy.saveRun(before);
    legacy.saveModel({
      id: "fixture",
      connection: "typesafe",
      model: "fixture",
    });
    legacy.setDefaults({ defaultId: "fixture", privateId: null });
    db.prepare(
      "INSERT INTO cache(key,created_at,response_json) VALUES ('legacy',0,'{}')",
    ).run();
    const repository = openJudgeStorage(bb.storage);
    assert.deepEqual(repository.getRun("legacy"), before);
    assert.equal(repository.getDefaults().defaultId, "fixture");
    assert.equal(repository.getModel("fixture")?.model, "fixture");
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM cache").get() as { n: number }).n,
      1,
    );
    repository.triggerAttempts.save(attempt(before));
    repository.publications.put("thread", summary(before), stamp);
    assert.equal(repository.triggerAttempts.list({ limit: 1 }).next, null);
    assert.equal(repository.publications.forThread("thread").length, 1);
    openJudgeStorage(bb.storage);
    assert.equal(repository.publications.forThread("thread").length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("run retention cascades attempt rows and preserves a tombstone for stale metadata cleanup", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const now = 10 * LIMITS.runAgeMs;
    const old = run("old", now - LIMITS.runAgeMs - 1);
    repository.saveRun(old, old.startedAt);
    repository.triggerAttempts.save(attempt(old));
    repository.publications.put("thread", summary(old), stamp);
    repository.publications.acknowledge("thread", [old.runId]);
    repository.saveRun(run("fresh", now), now);
    assert.equal(repository.getRun("old"), null);
    assert.equal(repository.triggerAttempts.get("old"), null);
    const ref = repository.publications.forThread("thread")[0]!;
    assert.equal(ref.runId, null);
    assert.equal(ref.summary.runId, "old");
    repository.publications.removeUnselected("thread", []);
    assert.equal(repository.publications.forThread("thread").length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("publication references cap at20 and transactional failure/corrupt diagnostics cannot silently change authority", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const db = bb.storage.database();
    const now = Date.now();
    for (let i = 0; i < 21; i++) {
      const value = run(`run-${i}`, now + i);
      repository.saveRun(value, now + i);
      repository.triggerAttempts.save(attempt(value));
      repository.publications.put("thread", summary(value), stamp);
    }
    assert.equal(repository.publications.forThread("thread").length, 20);
    assert.ok(
      !repository.publications
        .forThread("thread")
        .some((ref) => ref.runId === "run-0"),
    );
    const refs = db
      .prepare("SELECT * FROM verdict_publications ORDER BY set_id")
      .all();
    const newest = run("new", now + 30);
    repository.saveRun(newest, now + 30);
    db.exec(
      "CREATE TRIGGER fail_pub_prune BEFORE DELETE ON verdict_publications BEGIN SELECT RAISE(ABORT, 'PRIVATE_STORAGE_DETAIL'); END;",
    );
    assert.throws(
      () => repository.publications.put("thread", summary(newest), stamp),
      PersistenceError,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM verdict_publications ORDER BY set_id").all(),
      refs,
    );
    db.exec("DROP TRIGGER fail_pub_prune");
    db.prepare(
      "UPDATE verdict_publications SET snapshot_json=? WHERE set_id='set-run-1'",
    ).run(JSON.stringify({ ...stamp, privateText: "PRIVATE" }));
    assert.throws(
      () => repository.publications.forThread("thread"),
      PersistenceError,
    );
    db.prepare(
      "UPDATE trigger_attempts SET record_json='PRIVATE' WHERE run_id='run-1'",
    ).run();
    assert.throws(() => repository.triggerAttempts.list({}), PersistenceError);
  } finally {
    await harness.lifecycle.dispose();
  }
});
