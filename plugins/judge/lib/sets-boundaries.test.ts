import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readSetYaml } from "./sets-yaml.ts";
import { parseSet } from "./sets-schema.ts";
import { SetService } from "./sets.ts";
import { createModelService } from "./models.ts";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import { setRecordSchema } from "./sets-contract.ts";

const base = {
  schemaVersion: 1,
  id: "fixture",
  description: "Public synthetic definition",
  inputs: { text: { from: "thread.title" } },
  questions: { q: { type: "noul", instructions: "Does text exist?" } },
  outcomes: { yes: { q: "q", gte: 0.5 } },
  cases: [],
};
test("expression depth16 works while17, oversize cases and lossy reserved maps fail", () => {
  let term: unknown = { q: "q", gte: 0.5 };
  for (let n = 0; n < 16; n++) term = { all: [term] };
  const allowed = { ...base, outcomes: { yes: term } };
  const parsed = readSetYaml(stringify(allowed));
  assert.equal(readSetYaml(parsed.yaml).hash, parsed.hash);
  assert.throws(() =>
    parseSet({ ...base, outcomes: { yes: { all: [term] } } }),
  );
  assert.throws(() =>
    parseSet({
      ...base,
      cases: [{ inputs: { text: "x".repeat(65537) }, expect: { yes: true } }],
    }),
  );
  const reserved = JSON.parse(JSON.stringify(base));
  reserved.outcomes = JSON.parse('{"__proto__":{"q":"q","gte":0.5}}');
  assert.throws(() => parseSet(reserved));
  assert.throws(() =>
    setRecordSchema.parse({ ...parsed, scope: "global", definition: base }),
  );
});

test("failed definition transaction preserves old set, trigger and acceptance; corrupt stored hashes fail closed", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const models = await createModelService(bb, repository);
    const sets = new SetService(repository, models);
    const saved = sets.save(stringify(base));
    const db = bb.storage.database();
    db.prepare(
      "INSERT INTO triggers(id,set_id,enabled,config_json) VALUES ('t','fixture',1,'{}')",
    ).run();
    db.prepare(
      "INSERT INTO calibration_acceptance(set_id,set_hash,fingerprints_json,test_run_id,accepted_at) VALUES ('fixture',?,'[]','test',0)",
    ).run(saved.hash);
    db.exec(
      "CREATE TRIGGER fail_set_write BEFORE UPDATE ON triggers BEGIN SELECT RAISE(ABORT, 'private error body'); END",
    );
    let invalidations = 0;
    models.onInvalidate(() => invalidations++);
    assert.throws(
      () => sets.save(stringify({ ...base, description: "Changed" })),
      PersistenceError,
    );
    assert.equal(sets.get("fixture")!.hash, saved.hash);
    assert.equal(
      (db.prepare("SELECT enabled FROM triggers").get() as { enabled: number })
        .enabled,
      1,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM calibration_acceptance")
          .get() as { n: number }
      ).n,
      1,
    );
    assert.equal(invalidations, 0);
    db.exec("DROP TRIGGER fail_set_write");
    db.prepare(
      "UPDATE question_sets SET hash = 'corrupt' WHERE id = 'fixture'",
    ).run();
    assert.throws(() => sets.get("fixture"), PersistenceError);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("set pages include applicability without hiding global definitions and end with null cursor", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const sets = new SetService(
      repository,
      await createModelService(bb, repository),
    );
    for (const id of ["a", "b", "c"])
      sets.save(
        stringify({ ...base, id, projects: id === "b" ? ["p"] : "all" }),
      );
    const first = sets.list({ limit: 2 });
    assert.deepEqual(
      first.sets.map((s) => [s.id, s.applicable]),
      [
        ["a", true],
        ["b", false],
      ],
    );
    const tail = sets.list({ limit: 1, after: first.next!, projectId: "p" });
    assert.equal(tail.sets[0]!.id, "c");
    assert.equal(tail.next, null);
    sets.project("p", false);
    assert.equal(
      sets.list({ limit: 3, projectId: "p" }).sets.every((s) => !s.applicable),
      true,
    );
    assert.equal(sets.list({ limit: 3 }).next, null);
  } finally {
    await harness.lifecycle.dispose();
  }
});
