import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import { LIMITS } from "./json.ts";

function run(id: string, now: number) {
  return {
    runId: id,
    set: { id: "fixture", scope: "global", hash: "a".repeat(64) },
    threadId: "thread",
    projectId: "project",
    startedAt: now,
    endedAt: now + 1,
    complete: false,
    calibrated: false,
    steps: {
      first: { status: "unavailable", reason: "error", code: "fixture_error" },
      second: { status: "skipped", reason: "upstream_unavailable" },
    },
    outcomes: {},
  };
}
test("clock-controlled run retention preserves exact age boundary and atomically cascades all dependent steps", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const now = 10 * LIMITS.runAgeMs;
    const cutoff = now - LIMITS.runAgeMs;
    repository.saveRun(run("old", cutoff - 1), cutoff - 1);
    repository.saveRun(run("boundary", cutoff), cutoff);
    repository.saveRun(run("fresh", now), now);
    assert.equal(repository.getRun("old"), null);
    assert.ok(repository.getRun("boundary"));
    assert.equal(
      (
        bb.storage
          .database()
          .prepare("SELECT COUNT(*) AS n FROM steps WHERE run_id = 'old'")
          .get() as { n: number }
      ).n,
      0,
    );
    const db = bb.storage.database();
    const before = db.prepare("SELECT * FROM runs ORDER BY id").all();
    const beforeSteps = db
      .prepare("SELECT * FROM steps ORDER BY run_id, ordinal")
      .all();
    db.exec(
      "CREATE TRIGGER fail_retention BEFORE DELETE ON steps BEGIN SELECT RAISE(ABORT, 'dummy-private-storage'); END;",
    );
    assert.throws(
      () =>
        repository.saveRun(
          run("failed", now + LIMITS.runAgeMs + 2),
          now + LIMITS.runAgeMs + 2,
        ),
      PersistenceError,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM runs ORDER BY id").all(),
      before,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM steps ORDER BY run_id, ordinal").all(),
      beforeSteps,
    );
    assert.equal(repository.getRun("failed"), null);
    db.exec("DROP TRIGGER fail_retention");
    repository.saveRun(
      run("later", now + LIMITS.runAgeMs + 2),
      now + LIMITS.runAgeMs + 2,
    );
    assert.equal(repository.getRun("fresh"), null);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM steps").get() as { n: number }).n,
      2,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("10,000-run cap deterministically breaks timestamp ties and deletes corresponding ordered steps", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const db = bb.storage.database();
    const now = Date.now();
    db.transaction(() => {
      const insertRun = db.prepare(
        "INSERT INTO runs(id, started_at, summary_json) VALUES (?, ?, '{}')",
      );
      const insertStep = db.prepare(
        "INSERT INTO steps(run_id,id,result_json,ordinal) VALUES (?, 'first', '{}', 0)",
      );
      for (let i = 0; i < LIMITS.runs + 5; i++) {
        const id = `seed-${String(i).padStart(5, "0")}`;
        insertRun.run(id, now - 1);
        insertStep.run(id);
      }
    })();
    repository.saveRun(run("latest", now), now);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n,
      10000,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM steps").get() as { n: number }).n,
      10001,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM steps WHERE run_id LIKE 'seed-%' AND run_id <= 'seed-00005'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    assert.ok(repository.getRun("latest"));
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM steps s LEFT JOIN runs r ON r.id=s.run_id WHERE r.id IS NULL",
          )
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
