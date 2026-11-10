import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify as yamlStringify } from "yaml";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readSetYaml } from "./sets-yaml.ts";
import { parseSet } from "./sets-schema.ts";
import { SetService } from "./sets.ts";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";
import { evaluateExpression, validateExpression } from "./outcomes.ts";
import judge from "../server.ts";
const stringify = (value: unknown) =>
  yamlStringify(value, { aliasDuplicateObjects: false });

export const singleDefinition = {
  schemaVersion: 1,
  id: "screen",
  description: "Synthetic set",
  projects: "all",
  inputs: { text: { from: "thread.lastAssistantText" } },
  questions: { q: { type: "noul", instructions: "Is text a question?" } },
  outcomes: { yes: { q: "q", gte: 0.7 } },
  cases: [
    { inputs: { text: "A public synthetic question?" }, expect: { yes: true } },
  ],
};
const yaml = stringify(singleDefinition);

test("YAML shorthand normalizes to main and canonical hashes survive export, comments and key order", () => {
  const a = readSetYaml(yaml);
  assert.equal(a.definition.steps[0]!.id, "main");
  assert.equal(a.definition.steps[0]!.inputs.text!.maxChars, 12000);
  assert.equal(a.definition.outcomes.yes, "main.yes");
  assert.deepEqual(a.definition.cases[0]!.inputs, {
    main: { text: "A public synthetic question?" },
  });
  assert.equal(readSetYaml(a.yaml).hash, a.hash);
  const perStep = {
    ...singleDefinition,
    cases: [
      {
        inputs: { main: { text: "A public synthetic question?" } },
        expect: { yes: true },
      },
    ],
  };
  assert.equal(readSetYaml(stringify(perStep)).hash, a.hash);
  assert.equal(
    readSetYaml(
      "# comment\n" +
        stringify(
          Object.fromEntries(Object.entries(singleDefinition).reverse()),
        ),
    ).hash,
    a.hash,
  );
});

test("strict YAML rejects duplicates, aliases/anchors, custom tags, nonstring keys and non-JSON values", () => {
  for (const bad of [
    yaml + "id: duplicate\n",
    yaml.replace(
      "description: Synthetic set",
      "description: &a Synthetic set",
    ) + "extra: *a\n",
    yaml.replace("description: Synthetic set", "description: !custom text"),
    yaml.replace("description: Synthetic set", "description: .nan"),
    yaml + "extra: {1: number-key}\n",
    yaml + "extra: true\n",
    yaml + "---\nid: second-document\n",
    " ".repeat(262145),
  ])
    assert.throws(() => readSetYaml(bad));
  const secretSnippet = "unique-private-source-snippet";
  assert.throws(
    () => readSetYaml("id: [" + secretSnippet),
    (error: unknown) =>
      error instanceof Error && !error.message.includes(secretSnippet),
  );
});

test("definitions reject mixed forms, duplicate IDs, unknown/forward/same-step refs and invalid predicates", () => {
  const normalized = readSetYaml(yaml).definition;
  for (const value of [
    { ...singleDefinition, steps: normalized.steps },
    { ...normalized, steps: [...normalized.steps, ...normalized.steps] },
    { ...normalized, projects: ["p", "p"] },
    { ...normalized, calibratedFor: ["m", "m"] },
    { ...normalized, outcomes: { bad: "later.no" } },
    { ...normalized, outcomes: { bad: { q: "q", gte: 0.3 } } },
    { ...normalized, steps: [{ ...normalized.steps[0], when: "main.yes" }] },
    ...[
      "main.yes",
      "later.yes",
      { all: [] },
      { any: [] },
      { q: "missing", gte: 0.5 },
      { q: "constructor", gte: 0.5 },
      { q: "q", gte: 1.1 },
      { q: "q", lte: -0.1 },
      { q: "q", gte: 0.1, is: "x" },
      { q: "q", gte: 0.1, lte: 0.5 },
    ].map((bad) => ({ ...singleDefinition, outcomes: { bad }, cases: [] })),
    {
      ...singleDefinition,
      cases: [{ inputs: { wrong: "x" }, expect: { yes: true } }],
    },
    {
      ...singleDefinition,
      inputs: { text: { from: "thread.title", private: false } },
    },
    { ...singleDefinition, inputs: { text: { from: "event.arbitrary" } } },
    { ...singleDefinition, inputs: { text: { from: "git.diff" } } },
    { ...singleDefinition, budgetMs: 30001 },
  ])
    assert.throws(() => parseSet(value));
  let deep: unknown = { q: "q", gte: 0.5 };
  for (let n = 0; n < 17; n++) deep = { not: deep };
  assert.throws(() =>
    parseSet({ ...singleDefinition, outcomes: { bad: deep }, cases: [] }),
  );
});

test("ordered multi-step references and complete per-step case inputs normalize without injecting prior answers", () => {
  const main = readSetYaml(yaml).definition.steps[0]!;
  const multi = {
    schemaVersion: 1,
    id: "multi",
    description: "Two public synthetic steps",
    steps: [
      { ...main, id: "screen" },
      {
        ...main,
        id: "check",
        when: { not: "screen.yes" },
        outcomes: { yes: { all: ["screen.yes", { q: "q", lte: 0.4 }] } },
      },
    ],
    outcomes: { final: { any: ["screen.yes", "check.yes"] } },
    cases: [
      {
        inputs: { screen: { text: "first" }, check: { text: "second" } },
        expect: { final: true },
      },
    ],
  };
  assert.equal(readSetYaml(stringify(multi)).definition.steps.length, 2);
  assert.throws(() =>
    parseSet({ ...multi, steps: [...multi.steps].reverse() }),
  );
  const cyclic = {
    ...multi,
    steps: [{ ...multi.steps[0], when: "check.yes" }, multi.steps[1]],
  };
  assert.throws(() => parseSet(cyclic));
});

test("typed outcome predicates use selected choice probability, fractional score, and refuse missing evidence beneath not", () => {
  const questions = {
    n: { type: "noul" as const, instructions: "q" },
    c: {
      type: "choice" as const,
      instructions: "q",
      criteria: { a: null, b: null },
    },
    s: {
      type: "score" as const,
      instructions: "q",
      criteria: [null, null, null],
    },
  };
  const answers = {
    n: { type: "noul" as const, noul: 0.7 },
    c: {
      type: "choice" as const,
      choice: "a",
      confidence: 0.99,
      probabilities: { a: 0.6, b: 0.4 },
    },
    s: {
      type: "score" as const,
      score: 1.2,
      confidence: 0.99,
      legend: { "0": null, "1": null, "2": null },
      probabilities: { "0": 0, "1": 0.8, "2": 0.2 },
    },
  };
  assert.equal(evaluateExpression({ q: "n", gte: 0.7 }, answers, {}), true);
  assert.equal(evaluateExpression({ q: "n", lte: 0.7 }, answers, {}), true);
  assert.equal(
    evaluateExpression({ q: "c", is: "a", gte: 0.7 }, answers, {}),
    false,
  );
  assert.equal(
    evaluateExpression({ q: "c", is: "b", gte: 0.1 }, answers, {}),
    false,
  );
  assert.equal(evaluateExpression({ q: "s", gte: 1.1 }, answers, {}), true);
  assert.equal(
    evaluateExpression(
      {
        all: [
          { q: "n", gte: 0.7 },
          { any: ["earlier.done", { not: { q: "s", lte: 1.1 } }] },
        ],
      },
      answers,
      { earlier: { done: false } },
    ),
    true,
  );
  for (const bad of [
    { q: "c", lte: 0.5 },
    { q: "c", is: "missing", gte: 0.5 },
    { q: "s", gte: 2.1 },
  ])
    assert.throws(() => validateExpression(bad, questions, new Map()));
  assert.throws(
    () => evaluateExpression({ not: "missing.done" }, answers, {}),
    /missing_evidence/,
  );
  assert.throws(
    () => evaluateExpression({ not: { q: "missing", gte: 0.5 } }, answers, {}),
    /missing_evidence/,
  );
});

test("global storage/project applicability, set edits/removal and project switches invalidate and disable safely", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repository = openJudgeStorage(bb.storage);
    const models = await createModelService(bb, repository);
    const sets = new SetService(repository, models);
    let invalidations = 0;
    models.onInvalidate(() => invalidations++);
    const saved = sets.save(yaml);
    assert.equal(sets.get("screen")!.hash, saved.hash);
    assert.equal(sets.applicable(saved.definition), true);
    const restricted = sets.save(
      stringify({ ...singleDefinition, projects: ["p"] }),
    );
    assert.equal(sets.applicable(restricted.definition), false);
    assert.equal(sets.applicable(restricted.definition, "p"), true);
    assert.equal(sets.applicable(restricted.definition, "other"), false);
    const db = bb.storage.database();
    db.prepare(
      "INSERT INTO triggers(id,set_id,enabled,config_json) VALUES ('t','screen',1,'{}')",
    ).run();
    db.prepare(
      "INSERT INTO calibration_acceptance(set_id,set_hash,fingerprints_json,test_run_id,accepted_at) VALUES ('screen',?,'[]','test',0)",
    ).run(saved.hash);
    db.prepare(
      "INSERT INTO cache(key,created_at,response_json) VALUES ('cache',0,'{}')",
    ).run();
    sets.save(yaml);
    assert.equal(
      (db.prepare("SELECT enabled FROM triggers").get() as { enabled: number })
        .enabled,
      0,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM calibration_acceptance")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM cache").get() as { n: number }).n,
      0,
    );
    sets.project("p", false);
    assert.equal(sets.applicable(saved.definition, "p"), false);
    assert.equal(sets.applicable(saved.definition), true);
    sets.remove("screen");
    assert.equal(sets.get("screen"), null);
    assert.ok(invalidations >= 5);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("management RPC validates output and exports normalized YAML without inference", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must remain offline");
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    await judge(bb);
    await harness.behavior.callRpc("sets.save", { yaml });
    const exported = (await harness.behavior.callRpc("sets.export", {
      id: "screen",
    })) as { yaml: string };
    assert.equal(readSetYaml(exported.yaml).hash, readSetYaml(yaml).hash);
    const page = (await harness.behavior.callRpc("sets.list", {})) as {
      sets: unknown[];
      next: unknown;
    };
    assert.equal(page.sets.length, 1);
    assert.equal(page.next, null);
    const cli = await harness.behavior.runCli([
      "questions",
      "export",
      "screen",
    ]);
    assert.equal(readSetYaml(cli.stdout).hash, readSetYaml(yaml).hash);
    for (const name of ["list", "show", "save", "import", "export", "remove"])
      assert.equal(
        (await harness.behavior.runCli(["questions", name, "--help"])).exitCode,
        0,
      );
    await assert.rejects(
      harness.behavior.callRpc("sets.save", { yaml: yaml + "unknown: true" }),
    );
    await assert.rejects(harness.behavior.callRpc("sets.list", { limit: 101 }));
  } finally {
    await harness.lifecycle.dispose();
  }
});
