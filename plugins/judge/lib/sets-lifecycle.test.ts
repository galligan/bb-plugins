import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { SetService } from "./sets.ts";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";
import judge from "../server.ts";

const base = {
  schemaVersion: 1,
  id: "fixture",
  description: "Public fixture",
  inputs: { text: { from: "thread.title" } },
  questions: { q: { type: "noul", instructions: "Does text exist?" } },
  outcomes: { yes: { q: "q", gte: 0.5 } },
};
test("all accepted input depths survive RPC save, output validation, normalized export and persisted read", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    await judge(bb);
    let value: unknown = "leaf";
    for (let depth = 0; depth <= 16; depth++) {
      for (const perStep of [false, true]) {
        const input = { text: value };
        const yaml = stringify({
          ...base,
          cases: [
            {
              inputs: perStep ? { main: input } : input,
              expect: { yes: true },
            },
          ],
        });
        const saved = (await harness.behavior.callRpc("sets.save", {
          yaml,
        })) as { hash: string };
        const shown = (await harness.behavior.callRpc("sets.show", {
          id: "fixture",
        })) as {
          hash: string;
          yaml: string;
          definition: { cases: { inputs: { main: { text: unknown } } }[] };
        };
        assert.equal(saved.hash, shown.hash);
        assert.deepEqual(shown.definition.cases[0]!.inputs.main.text, value);
        const imported = (await harness.behavior.callRpc("sets.import", {
          yaml: shown.yaml,
        })) as { hash: string };
        assert.equal(imported.hash, saved.hash);
      }
      value = { nested: value };
    }
    await assert.rejects(
      harness.behavior.callRpc("sets.save", {
        yaml: stringify({
          ...base,
          cases: [{ inputs: { text: value }, expect: { yes: true } }],
        }),
      }),
    );
    const listed = (await harness.behavior.callRpc("sets.list", {})) as {
      sets: unknown[];
    };
    assert.equal(listed.sets.length, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("disposed and invalidation-failed services refuse save/remove/project before any transaction changes", async () => {
  for (const state of ["disposed", "invalidation_failed"] as const) {
    for (const mutation of ["save", "remove", "project"] as const) {
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
        if (state === "disposed") models.dispose();
        else {
          db.exec(
            "INSERT INTO cache VALUES ('old',0,'{}'); CREATE TRIGGER fail_prune BEFORE DELETE ON cache BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
          );
          await harness.behavior.setSettings({
            typesafeApiKey: "dummy-offline-only",
          });
          db.exec("DROP TRIGGER fail_prune");
        }
        assert.throws(
          () => {
            if (mutation === "save")
              sets.save(stringify({ ...base, description: "Changed" }));
            if (mutation === "remove") sets.remove("fixture");
            if (mutation === "project") sets.project("p", false);
          },
          state === "disposed"
            ? /cancelled/
            : /configuration_invalidation_failed/,
        );
        assert.equal(sets.get("fixture")!.hash, saved.hash);
        assert.equal(repository.definitions.projectEnabled("p"), true);
        assert.equal(
          (
            db.prepare("SELECT enabled FROM triggers").get() as {
              enabled: number;
            }
          ).enabled,
          1,
        );
      } finally {
        await harness.lifecycle.dispose();
      }
    }
  }
});

test("throwing abort subscribers do not turn committed definition mutations into failed responses", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const models = await createModelService(bb, repository);
    const sets = new SetService(repository, models);
    let notified = 0;
    models.onInvalidate(() => {
      throw new Error("fixture callback failure");
    });
    models.onInvalidate(() => notified++);
    assert.ok(sets.save(stringify(base)).hash);
    assert.equal(sets.project("p", false).enabled, false);
    assert.equal(sets.remove("fixture").removed, true);
    assert.equal(sets.get("fixture"), null);
    assert.equal(notified, 3);
  } finally {
    await harness.lifecycle.dispose();
  }
});
