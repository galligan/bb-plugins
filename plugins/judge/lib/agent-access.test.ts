import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import {
  setupRunner,
  fixtureHostOptions,
  question,
} from "./runner-fixtures.ts";
import { registerAgentAccess } from "./agent-access.ts";
import { parseAgentInput, agentParameters } from "./agent-contract.ts";
import { agentOutput, AGENT_OUTPUT_BYTES } from "./agent-output.ts";
import { parseVerdict } from "./results.ts";
const context = { threadId: "thread", projectId: "project" };
async function setup(fetcher?: typeof fetch) {
  const h = await setupRunner(
    createFakePluginHost({ ...fixtureHostOptions, agentSkillIds: ["judge"] }),
    fetcher,
  );
  await registerAgentAccess(h.bb, h.api);
  return h;
}
function data(
  result: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof setup>>["harness"]["behavior"]["callAgentTool"]
    >
  >,
) {
  if (typeof result === "string") return JSON.parse(result);
  const text = result.content.find((entry) => entry.type === "text");
  assert.ok(text && text.type === "text");
  return JSON.parse(text.text);
}
test("agent tool/skill are excluded by default; explicit setting selects them without inference or policy changes", async () => {
  const h = await setup();
  try {
    const configuration = makePluginAgentConfigurationContext();
    const excluded =
      await h.harness.behavior.resolveAgentConfiguration(configuration);
    assert.deepEqual(excluded.tools, []);
    assert.deepEqual(excluded.skills, []);
    assert.equal(
      data(
        await h.harness.behavior.callAgentTool(
          "judge_ask",
          { ask: { state: {}, questions: question } },
          context,
        ),
      ).error.code,
      "agent_tool_disabled",
    );
    const generation = h.api.models.configurationGeneration();
    await h.harness.behavior.setSettings({ enableAgentTool: true });
    const included =
      await h.harness.behavior.resolveAgentConfiguration(configuration);
    assert.deepEqual(
      included.tools.map((t) => t.name),
      ["judge_ask"],
    );
    assert.deepEqual(included.skills, ["judge"]);
    assert.equal(h.api.models.configurationGeneration(), generation);
    assert.equal(h.bodies.length, 0);
    assert.deepEqual(h.repository.getDefaults(), {
      defaultId: "public",
      privateId: "private",
    });
    assert.equal(
      (included.tools[0]!.inputSchema as { type: string }).type,
      "object",
    );
    assert.equal(
      (included.tools[0]!.inputSchema as { additionalProperties: boolean })
        .additionalProperties,
      false,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("agent ad hoc input stays sensitive, source overrides cannot lower privacy, and successful requests retain caller attribution", async () => {
  const h = await setup();
  try {
    await h.harness.behavior.setSettings({ enableAgentTool: true });
    h.api.models.setDefault(null, true);
    const blocked = data(
      await h.harness.behavior.callAgentTool(
        "judge_ask",
        {
          ask: {
            state: { fixture: "PUBLIC_AUTHORED_TEXT" },
            questions: question,
            model: "public",
          },
        },
        context,
      ),
    );
    assert.equal(blocked.verdict.complete, false);
    assert.equal(blocked.verdict.steps.main.reason, "private_not_allowed");
    assert.equal(h.bodies.length, 0);
    const answer = data(
      await h.harness.behavior.callAgentTool(
        "judge_ask",
        {
          ask: {
            state: { fixture: "AUTHORED_TEXT" },
            questions: question,
            model: "private",
          },
        },
        context,
      ),
    );
    assert.equal(answer.kind, "verdict");
    assert.equal(answer.verdict.complete, true);
    assert.equal(answer.verdict.threadId, "thread");
    assert.equal(answer.verdict.projectId, "project");
    assert.equal(answer.verdict.steps.main.resolvedModel.id, "private");
    assert.deepEqual(h.repository.getRun(answer.verdict.runId), answer.verdict);
    const run = data(
      await h.harness.behavior.callAgentTool(
        "judge_ask",
        { run: { id: "synthetic", model: "private" } },
        context,
      ),
    );
    assert.equal(run.verdict.complete, true);
    assert.equal(run.verdict.calibrated, false);
    assert.equal(run.verdict.steps.screen.status, "ran");
    assert.equal(run.verdict.steps.detail.status, "ran");
    assert.ok(!JSON.stringify(run).includes("dummy-runner-secret"));
    assert.ok(!JSON.stringify(answer).includes("AUTHORED_TEXT"));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("tool rejects malformed arguments and all management/privacy/context overrides before source or provider dispatch", async () => {
  const h = await setup();
  try {
    await h.harness.behavior.setSettings({ enableAgentTool: true });
    const ask = { state: {}, questions: question, model: "private" };
    const invalid = [
      {},
      { ask, run: { id: "synthetic" } },
      { ask, enable: true },
      { ask: { ...ask, notPrivate: true } },
      { ask: { ...ask, allowPrivate: true } },
      { ask: { ...ask, threadId: "other" } },
      { run: { id: "synthetic", projectId: "other" } },
      { run: { id: "synthetic", notPrivate: true } },
      { run: { id: "synthetic", acceptCalibration: true } },
      { run: { id: "synthetic", connection: "custom" } },
      { ask: { ...ask, state: "x".repeat(262144) } },
      JSON.parse(
        '{"ask":{"state":{},"questions":{"q":{"type":"noul","instructions":"Synthetic"}}},"__proto__":{"manage":true}}',
      ),
    ];
    for (const input of invalid) {
      assert.throws(() => parseAgentInput(input));
      const result = await h.harness.behavior.callAgentTool(
        "judge_ask",
        input,
        context,
      );
      assert.ok(typeof result !== "string" && result.isError === true);
      assert.equal(data(result).error.code, "invalid_input");
    }
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    assert.equal(h.repository.listRuns().length, 0);
    assert.deepEqual(h.repository.getDefaults(), {
      defaultId: "public",
      privateId: "private",
    });
    assert.deepEqual(h.api.triggers.list({}).triggers, []);
    assert.equal(agentParameters.oneOf.length, 2);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("revoking tool access aborts active inference and denies stale selections; caller pre-abort does no work", async () => {
  let entered = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = await setup(async () => {
    entered();
    return new Promise<Response>(() => {});
  });
  try {
    await h.harness.behavior.setSettings({ enableAgentTool: true });
    const pending = h.harness.behavior.callAgentTool(
      "judge_ask",
      { ask: { state: {}, questions: question, model: "private" } },
      context,
    );
    await ready;
    await h.harness.behavior.setSettings({ enableAgentTool: false });
    const stopped = data(await pending);
    assert.equal(stopped.verdict.complete, false);
    assert.equal(stopped.verdict.steps.main.reason, "cancelled");
    assert.equal(h.bodies.length, 1);
    assert.equal(h.repository.listRuns().length, 1);
    const disabled = await h.harness.behavior.callAgentTool(
      "judge_ask",
      { ask: { state: {}, questions: question } },
      context,
    );
    assert.equal(data(disabled).error.code, "agent_tool_disabled");
    const signal = new AbortController();
    signal.abort();
    const pre = await h.harness.behavior.callAgentTool(
      "judge_ask",
      { run: { id: "synthetic" } },
      { ...context, signal: signal.signal },
    );
    assert.equal(data(pre).error.code, "cancelled");
    assert.equal(h.bodies.length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
test("large typed answers are omitted as whole answers with truthful bounded diagnostics and persistent run identity", () => {
  const run = parseVerdict({
    runId: "large-run",
    set: null,
    threadId: "thread",
    projectId: "project",
    startedAt: 1000,
    endedAt: 1001,
    complete: true,
    calibrated: false,
    outcomes: {},
    steps: {
      main: {
        status: "ran",
        requestedModel: "private",
        resolvedModel: {
          id: "private",
          connection: "typesafe",
          model: "fixture",
          fingerprint: "a".repeat(64),
        },
        fallbackReason: null,
        answers: {
          q: {
            type: "score",
            score: 0,
            confidence: 1,
            legend: { "0": "a".repeat(40000), "1": "b".repeat(40000) },
            probabilities: { "0": 1, "1": 0 },
          },
        },
        outcomes: {},
        latencyMs: 1,
        inputTokens: 1,
        cacheHit: false,
        provenance: {},
      },
    },
  });
  const output = agentOutput(run),
    parsed = JSON.parse(output);
  assert.ok(Buffer.byteLength(output, "utf8") <= AGENT_OUTPUT_BYTES);
  assert.equal(parsed.kind, "summary");
  assert.equal(parsed.answersOmitted, true);
  assert.equal(parsed.verdict.runId, run.runId);
  assert.equal(parsed.verdict.complete, true);
  assert.equal(parsed.verdict.steps.main.status, "ran");
  assert.ok(!output.includes("legend"));
});
