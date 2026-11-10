import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  definition,
  fixtureHostOptions,
  setupRunner,
  thread,
} from "./runner-fixtures.ts";
import { parseVerdict } from "./results.ts";
import { runSchema } from "./run-contract.ts";
import { PersistenceError } from "./storage.ts";
const setup = (fetcher?: typeof fetch) =>
  setupRunner(createFakePluginHost(fixtureHostOptions), fetcher);

test("sequential saved-set RPC records model precedence/private fallback, source provenance and no earlier answers in later state", async () => {
  const h = await setup();
  try {
    const result = parseVerdict(
      await h.harness.behavior.callRpc("run", {
        id: "synthetic",
        threadId: "thread",
      }),
    );
    assert.equal(result.complete, true);
    assert.equal(result.calibrated, false);
    assert.equal(result.projectId, "project");
    assert.equal(result.threadId, "thread");
    assert.equal(result.set?.id, "synthetic");
    assert.match(result.set!.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.outcomes, { accepted: true });
    assert.deepEqual(
      h.bodies.map((b) => b.state),
      [{ provider: "codex" }, { reply: "Synthetic reply" }],
    );
    assert.deepEqual(
      h.bodies.map((b) => b.model),
      ["public-selector", "private-selector"],
    );
    const first = result.steps.screen!;
    const second = result.steps.detail!;
    assert.ok(first.status === "ran" && second.status === "ran");
    assert.equal(first.requestedModel, "public");
    assert.equal(first.resolvedModel.id, "public");
    assert.equal(first.fallbackReason, null);
    assert.equal(first.providerModel, "fixture-version");
    assert.equal(second.requestedModel, "public");
    assert.equal(second.resolvedModel.id, "private");
    assert.equal(second.fallbackReason, "private_not_allowed");
    assert.equal(second.provenance.reply?.source, "thread.lastAssistantText");
    assert.deepEqual(h.repository.getRun(result.runId), result);
    assert.ok(!JSON.stringify(result).includes("Synthetic reply"));
    assert.ok(!JSON.stringify(result).includes("dummy-runner-secret"));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("gate-false resolves no source or transport, yields false step outcomes and can support explicit final negation", async () => {
  const h = await setup(async () =>
    Response.json({
      model: "fixture",
      answers: { q: { type: "noul", noul: 0.1 } },
    }),
  );
  try {
    const set = definition();
    set.outcomes = { accepted: { not: "detail.ok" } } as never;
    h.api.sets.save(JSON.stringify(set));
    const result = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    assert.equal(result.complete, true);
    assert.equal(h.bodies.length, 1);
    assert.deepEqual(result.steps.detail, {
      status: "skipped",
      reason: "gate_false",
    });
    assert.deepEqual(result.outcomes, { accepted: true });
    assert.equal(h.harness.inspection.sdk.callsTo("threads.output").length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("unavailable source or malformed response stops later steps and cannot turn negation into true", async () => {
  for (const failure of ["source", "response"]) {
    const h = await setup(
      failure === "response"
        ? async () =>
            Response.json({
              model: "fixture",
              answers: { q: { type: "noul", noul: 2 } },
            })
        : undefined,
    );
    try {
      const set = definition();
      set.outcomes = { accepted: { not: "detail.ok" } } as never;
      h.api.sets.save(JSON.stringify(set));
      const result = await h.api.runner.run({
        id: "synthetic",
        ...(failure === "response" ? { threadId: "thread" } : {}),
      });
      assert.equal(result.complete, false);
      assert.deepEqual(result.outcomes, {});
      assert.equal(
        result.steps.screen?.status === "unavailable" &&
          result.steps.screen.reason,
        failure === "source" ? "source_unavailable" : "invalid_response",
      );
      assert.deepEqual(result.steps.detail, {
        status: "skipped",
        reason: "upstream_unavailable",
      });
      assert.equal(h.bodies.length, failure === "source" ? 0 : 1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("later failure preserves earlier success and skips every subsequent step", async () => {
  const h = await setup();
  try {
    const set = definition();
    set.steps.push({ ...set.steps[1]!, id: "last", when: "screen.ok" });
    h.api.sets.save(JSON.stringify(set));
    h.harness.sdk.stub("threads.output", async () => ({ output: null }));
    const result = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    assert.equal(result.steps.screen?.status, "ran");
    assert.deepEqual(result.steps.detail, {
      status: "unavailable",
      reason: "source_unavailable",
      code: "assistant_text_missing",
    });
    assert.deepEqual(result.steps.last, {
      status: "skipped",
      reason: "upstream_unavailable",
    });
    assert.deepEqual(result.outcomes, {});
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("call override beats step/set/global, then step/set, then explicit global", async () => {
  const h = await setup();
  try {
    for (const id of ["call", "step", "set"])
      h.api.models.save({
        id,
        model: `${id}-selector`,
        connection: "typesafe",
      });
    const set = definition();
    set.steps[1]!.inputs = { provider: { from: "provider.id" } } as never;
    const configured = {
      ...set,
      model: "set",
      steps: [{ ...set.steps[0]!, model: "step" }, set.steps[1]!],
    };
    h.api.sets.save(JSON.stringify(configured));
    await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
      model: "call",
    });
    await h.api.runner.run({ id: "synthetic", threadId: "thread" });
    h.api.sets.save(JSON.stringify(set));
    await h.api.runner.run({ id: "synthetic", threadId: "thread" });
    assert.deepEqual(
      h.bodies.map((b) => b.model),
      [
        "call-selector",
        "call-selector",
        "step-selector",
        "set-selector",
        "public-selector",
        "public-selector",
      ],
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("caller input overrides are exact declared names and always private, even public-looking source values", async () => {
  const h = await setup();
  try {
    const input = {
      id: "synthetic",
      inputs: {
        screen: { provider: "public-looking" },
        detail: { reply: "synthetic" },
      },
    };
    const result = await h.api.runner.run(input);
    assert.equal(result.complete, true);
    assert.deepEqual(
      h.bodies.map((b) => b.model),
      ["private-selector", "private-selector"],
    );
    const first = result.steps.screen!;
    assert.ok(first.status === "ran");
    assert.equal(first.provenance.provider?.source, "caller_override");
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    h.api.models.setDefault(null, true);
    const refused = await h.api.runner.run(input);
    assert.equal(
      refused.steps.screen?.status === "unavailable" &&
        refused.steps.screen.reason,
      "private_not_allowed",
    );
    assert.equal(h.bodies.length, 2);
    for (const inputs of [{ missing: {} }, { screen: { unknown: "x" } }])
      await assert.rejects(h.api.runner.run({ id: "synthetic", inputs }));
    assert.equal(h.repository.listRuns().length, 2);
    assert.equal(
      runSchema.safeParse({ id: "synthetic", notPrivate: true }).success,
      false,
    );
    assert.equal(
      runSchema.safeParse({ id: "synthetic", environmentId: "other" }).success,
      false,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("project applicability uses validated thread context and project switch; wrong context never dispatches", async () => {
  const h = await setup();
  try {
    h.api.sets.project("project", false);
    const blocked = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    assert.deepEqual(blocked.steps.screen, {
      status: "unavailable",
      reason: "source_unavailable",
      code: "set_not_applicable",
    });
    assert.equal(h.harness.inspection.sdk.callsTo("threads.output").length, 0);
    h.api.sets.project("project", true);
    const set = { ...definition(), projects: ["other"] };
    h.api.sets.save(JSON.stringify(set));
    for (const input of [
      { id: "synthetic", threadId: "thread" },
      { id: "synthetic" },
    ]) {
      const result = await h.api.runner.run(input);
      assert.equal(result.complete, false);
    }
    await assert.rejects(
      h.api.runner.run({
        id: "synthetic",
        threadId: "thread",
        projectId: "other",
      }),
    );
    h.harness.sdk.stub("threads.get", async () => ({
      ...thread,
      id: "different",
    }));
    await assert.rejects(
      h.api.runner.run({ id: "synthetic", threadId: "thread" }),
    );
    assert.equal(h.bodies.length, 0);
    assert.equal(h.repository.listRuns().length, 3);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("Git sources use only the validated thread environment, carry provenance and apply private policy", async () => {
  const h = await setup();
  try {
    const set = definition();
    set.steps[0]!.inputs = {
      patch: { from: "git.diff", target: "uncommitted" },
    } as never;
    h.api.sets.save(JSON.stringify(set));
    const result = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    const first = result.steps.screen!;
    assert.ok(first.status === "ran");
    assert.equal(first.provenance.patch?.selection.environmentId, "exact-env");
    assert.equal(first.resolvedModel.id, "private");
    const rpc = h.harness.inspection.sdk.callsTo("plugins.callRpc")[0]![0] as {
      input: { environmentId: string };
    };
    assert.equal(rpc.input.environmentId, "exact-env");
    h.harness.sdk.stub("threads.get", async () => ({
      ...thread,
      environmentId: null,
    }));
    const missing = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    assert.deepEqual(missing.steps.screen, {
      status: "unavailable",
      reason: "source_unavailable",
      code: "environment_required",
    });
    assert.equal(h.harness.inspection.sdk.callsTo("plugins.callRpc").length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("saved-set CLI shares RPC runner, rejects mixed ad hoc/disclosure flags and supports explicit thread", async () => {
  const h = await setup();
  try {
    const success = await h.harness.behavior.runCli([
      "ask",
      "synthetic",
      "--thread",
      "thread",
      "--json",
    ]);
    assert.equal(success.exitCode, 0);
    assert.equal(parseVerdict(JSON.parse(success.stdout)).complete, true);
    for (const args of [
      ["--not-private"],
      ["--state", "{}"],
      ["--noul", "q"],
      ["--questions", "{}"],
    ]) {
      const invalid = await h.harness.behavior.runCli([
        "ask",
        "synthetic",
        ...args,
        "--json",
      ]);
      assert.equal(invalid.exitCode, 1);
    }
    const unknown = await h.harness.behavior.runCli([
      "ask",
      "missing",
      "--json",
    ]);
    assert.equal(unknown.exitCode, 1);
    assert.equal(h.bodies.length, 2);
    const help = await h.harness.behavior.runCli(["ask", "--help"]);
    assert.match(help.stdout, /saved|Saved/);
    assert.match(help.stdout, /--thread/);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("persistence failure suppresses both RPC and CLI success and leaves no partial run", async (t) => {
  const h = await setup();
  try {
    t.mock.method(h.repository, "saveRun", () => {
      throw new PersistenceError();
    });
    await assert.rejects(
      h.harness.behavior.callRpc("run", {
        id: "synthetic",
        threadId: "thread",
      }),
      /persistence_failed/,
    );
    const cli = await h.harness.behavior.runCli([
      "ask",
      "synthetic",
      "--thread",
      "thread",
      "--json",
    ]);
    assert.equal(cli.exitCode, 1);
    assert.equal(JSON.parse(cli.stdout).error.code, "persistence_failed");
    assert.ok(!cli.stdout.includes("runId"));
    assert.equal(h.repository.listRuns().length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("assembled request bounds include questions and enclosing state depth, without simplifying inputs", async () => {
  const h = await setup();
  try {
    const set = definition();
    set.steps[0]!.inputs = Object.fromEntries(
      ["a", "b", "c", "d"].map((name) => [
        name,
        { from: "provider.id", maxChars: 65536 },
      ]),
    );
    set.steps[0]!.questions = {
      q: { type: "noul", instructions: "q".repeat(10000) },
    };
    h.api.sets.save(JSON.stringify(set));
    const large = await h.api.runner.run({
      id: "synthetic",
      inputs: {
        screen: Object.fromEntries(
          ["a", "b", "c", "d"].map((name) => [name, "x".repeat(64000)]),
        ),
      },
    });
    assert.deepEqual(large.steps.screen, {
      status: "unavailable",
      reason: "too_large",
      code: "request_bounds",
    });
    h.api.sets.save(JSON.stringify(definition()));
    let value: unknown = "leaf";
    for (let i = 0; i < 16; i++) value = { nested: value };
    const deep = await h.api.runner.run({
      id: "synthetic",
      inputs: { screen: { provider: value } },
    });
    assert.deepEqual(deep.steps.screen, {
      status: "unavailable",
      reason: "too_large",
      code: "request_bounds",
    });
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("ad hoc explicit current-thread attribution preserves the known project without assigning it to another thread", async () => {
  const h = await setup();
  try {
    for (const threadId of ["thread", "different-thread"]) {
      const result = await h.harness.behavior.runCli(
        [
          "ask",
          "--thread",
          threadId,
          "--state",
          "{}",
          "--noul",
          "Synthetic?",
          "--not-private",
          "--json",
        ],
        { threadId: "thread", projectId: "project" },
      );
      assert.equal(result.exitCode, 0);
      const verdict = parseVerdict(JSON.parse(result.stdout));
      assert.equal(verdict.threadId, threadId);
      assert.equal(verdict.projectId, threadId === "thread" ? "project" : null);
      assert.equal(
        h.repository.getRun(verdict.runId)?.projectId,
        verdict.projectId,
      );
    }
    assert.equal(h.harness.inspection.sdk.callsTo("threads.get").length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
