import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions, setupRunner } from "./runner-fixtures.ts";
import { readSetYaml } from "./sets-yaml.ts";
import { parseVerdict } from "./results.ts";

const setup = (fetcher?: typeof fetch) =>
  setupRunner(createFakePluginHost(fixtureHostOptions), fetcher);
const ids = ["needs-attention", "completion-check", "diff-lint"];

test("template listing is inert and all three definitions normalize with representative cases", async () => {
  const h = await setup();
  try {
    const before = h.api.sets.list({}).sets;
    const listed = h.api.templates.list();
    assert.deepEqual(
      listed.map((t) => t.id),
      ids,
    );
    assert.deepEqual(
      await h.harness.behavior.callRpc("templates.list", {}),
      listed,
    );
    for (const item of listed) {
      assert.equal(item.version, "1.0.0");
      assert.equal(item.caseCount, 4);
      assert.match(item.description, /uncalibrated/);
      const copy = h.api.templates.use(item.id, `copy-${item.id}`);
      assert.equal(copy.definition.origin, `${item.id}@1.0.0`);
      assert.deepEqual(copy.definition.calibratedFor, []);
      assert.equal(copy.definition.model, undefined);
      assert.deepEqual(
        copy.definition.cases.map((c) => c.id),
        ["positive", "negative", "absent", "ambiguous"],
      );
      assert.equal(readSetYaml(copy.yaml).hash, copy.hash);
      assert.equal(copy.definition.projects, "all");
    }
    assert.equal(before.length, 1);
    assert.equal(h.bodies.length, 0);
    assert.equal(h.repository.listRuns().length, 0);
    const db = h.bb.storage.database();
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM triggers").get() as { n: number })
        .n,
      0,
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM calibration_acceptance")
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("copies are independent editable sets, reject replacement, and never inherit activation or acceptance", async () => {
  const h = await setup();
  try {
    const db = h.bb.storage.database();
    db.prepare("INSERT INTO triggers VALUES (?, ?, ?, ?)").run(
      "old-trigger",
      "my-attention",
      1,
      "{}",
    );
    db.prepare("INSERT INTO calibration_acceptance VALUES (?, ?, ?, ?, ?)").run(
      "my-attention",
      "old-hash",
      "{}",
      "old-test",
      1,
    );
    const copied = h.api.templates.use("needs-attention", "my-attention");
    assert.equal(
      (
        db
          .prepare("SELECT enabled FROM triggers WHERE id = ?")
          .get("old-trigger") as { enabled: number }
      ).enabled,
      0,
    );
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM calibration_acceptance")
          .get() as { n: number }
      ).n,
      0,
    );
    const edited = h.api.sets.save(
      JSON.stringify({
        ...copied.definition,
        description: "User's independent edited definition",
      }),
    );
    assert.notEqual(edited.hash, copied.hash);
    assert.equal(edited.definition.origin, "needs-attention@1.0.0");
    const second = h.api.templates.use("needs-attention", "second-attention");
    assert.equal(second.definition.description, copied.definition.description);
    assert.notEqual(second.hash, copied.hash); // Target ID is part of the saved definition hash.
    assert.throws(() => h.api.templates.use("needs-attention", "my-attention"));
    assert.equal(h.api.sets.get("my-attention")!.hash, edited.hash);
    assert.throws(() => h.api.templates.use("unknown-template", "missing"));
    assert.throws(() => h.api.templates.use("needs-attention", "bad id"));
    h.api.models.dispose();
    assert.throws(() =>
      h.api.templates.use("needs-attention", "after-dispose"),
    );
    assert.equal(h.api.sets.get("after-dispose"), null);
    assert.equal(h.bodies.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

// Recorded synthetic answers test execution mechanics, not model quality/calibration.
const answers: Record<string, Record<string, Record<string, number>[]>> = {
  "needs-attention": {
    positive: [{ evidence_present: 0.95, needs_answer: 0.95 }],
    negative: [{ evidence_present: 0.95, needs_answer: 0.05 }],
    absent: [{ evidence_present: 0.05, needs_answer: 0.05 }],
    ambiguous: [{ evidence_present: 0.4, needs_answer: 0.4 }],
  },
  "completion-check": {
    positive: [{ claims_completion: 0.95 }, { observed_check: 0.05 }],
    negative: [{ claims_completion: 0.95 }, { observed_check: 0.95 }],
    absent: [{ claims_completion: 0.05 }],
    ambiguous: [{ claims_completion: 0.45 }],
  },
  "diff-lint": {
    positive: [
      {
        debug_output: 0.95,
        disabled_verification: 0.95,
        obvious_defect: 0.05,
      },
    ],
    negative: [
      {
        debug_output: 0.05,
        disabled_verification: 0.05,
        obvious_defect: 0.05,
      },
    ],
    absent: [
      {
        debug_output: 0.05,
        disabled_verification: 0.05,
        obvious_defect: 0.05,
      },
    ],
    ambiguous: [
      {
        debug_output: 0.2,
        disabled_verification: 0.2,
        obvious_defect: 0.2,
      },
    ],
  },
};
test("all twelve authored cases bypass sources, retain privacy, and exercise normalized outcomes and gates", async () => {
  let remaining: Record<string, number>[] = [];
  const h = await setup(async (_url, init) => {
    const scores = remaining.shift();
    assert.ok(scores, "one fixture per executed step");
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(
      Object.keys(request.questions).sort(),
      Object.keys(scores).sort(),
    );
    assert.equal(request.model, "private-selector");
    return Response.json({
      model: "template-fixture-v1",
      answers: Object.fromEntries(
        Object.entries(scores).map(([id, noul]) => [
          id,
          { type: "noul", noul },
        ]),
      ),
    });
  });
  try {
    for (const id of ids) {
      const copy = h.api.templates.use(id, `exercise-${id}`);
      for (const authored of copy.definition.cases) {
        remaining = [...answers[id]![authored.id!]!];
        const result = parseVerdict(
          await h.harness.behavior.callRpc("run", {
            id: copy.definition.id,
            inputs: authored.inputs,
          }),
        );
        assert.equal(result.complete, true);
        assert.equal(result.calibrated, false);
        assert.deepEqual(
          result.outcomes,
          authored.expect,
          `${id}/${authored.id}`,
        );
        assert.equal(remaining.length, 0);
        for (const step of Object.values(result.steps))
          if (step.status === "ran") {
            assert.equal(step.resolvedModel.id, "private");
            assert.equal(step.fallbackReason, "private_not_allowed");
            for (const provenance of Object.values(step.provenance))
              assert.equal(provenance.source, "caller_override");
          }
        if (
          id === "completion-check" &&
          ["absent", "ambiguous"].includes(authored.id!)
        )
          assert.deepEqual(result.steps.verify, {
            status: "skipped",
            reason: "gate_false",
          });
      }
    }
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    assert.equal(h.bodies.length, 14);
    assert.equal(h.repository.listRuns().length, 12);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("template cases cannot disclose public-looking fixtures without a private-capable policy", async () => {
  const h = await setup();
  try {
    const copy = h.api.templates.use("needs-attention", "private-fixture");
    h.api.models.setDefault(null, true);
    const result = await h.api.runner.run({
      id: copy.definition.id,
      inputs: copy.definition.cases[0]!.inputs,
    });
    assert.deepEqual(result.steps.main, {
      status: "unavailable",
      reason: "private_not_allowed",
      code: "private_model_required",
    });
    assert.equal(result.complete, false);
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("template CLI/RPC help, strict arguments and copy provenance match implemented behavior", async () => {
  const h = await setup();
  try {
    for (const args of [
      ["templates"],
      ["templates", "list"],
      ["templates", "use"],
    ]) {
      const help = await h.harness.behavior.runCli([...args, "--help"]);
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /template/i);
    }
    const list = await h.harness.behavior.runCli([
      "templates",
      "list",
      "--json",
    ]);
    assert.deepEqual(
      JSON.parse(list.stdout).map((t: { id: string }) => t.id),
      ids,
    );
    const copy = await h.harness.behavior.runCli([
      "templates",
      "use",
      "diff-lint",
      "--id",
      "my-diff",
      "--json",
    ]);
    assert.equal(copy.exitCode, 0);
    assert.equal(JSON.parse(copy.stdout).definition.origin, "diff-lint@1.0.0");
    for (const args of [
      ["templates", "use", "diff-lint"],
      ["templates", "use", "diff-lint", "--id", "my-diff"],
      ["templates", "use", "diff-lint", "--id", "another", "--enable"],
    ])
      assert.equal(
        (await h.harness.behavior.runCli([...args, "--json"])).exitCode,
        1,
      );
    await assert.rejects(
      h.harness.behavior.callRpc("templates.use", {
        template: "diff-lint",
        id: "another",
        enable: true,
      }),
    );
    await assert.rejects(
      h.harness.behavior.callRpc("templates.list", { extra: true }),
    );
    assert.equal(h.bodies.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("template origin is bounded advisory provenance and survives canonical export/import", async () => {
  const h = await setup();
  try {
    const copy = h.api.templates.use("completion-check", "origin-test");
    assert.equal(
      readSetYaml(copy.yaml).definition.origin,
      "completion-check@1.0.0",
    );
    for (const origin of [
      "missing-version",
      "name@latest",
      "name@1.0",
      "x".repeat(257),
    ])
      assert.throws(() =>
        readSetYaml(JSON.stringify({ ...copy.definition, origin })),
      );
    const editedOrigin = h.api.sets.save(
      JSON.stringify({ ...copy.definition, origin: "user-declared@2.0.0" }),
    );
    assert.notEqual(editedOrigin.hash, copy.hash);
    assert.deepEqual(editedOrigin.definition.calibratedFor, []);
    assert.equal(h.bodies.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
