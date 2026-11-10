import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  definition,
  fixtureHostOptions,
  question,
  setupRunner,
} from "./runner-fixtures.ts";
import { registerAgentAccess } from "./agent-access.ts";

function text(result: unknown) {
  return JSON.parse(
    (result as { content: { text: string }[] }).content[0]!.text,
  );
}

test("a delayed enabled read cannot reverse revocation or revive a request after re-enable", async (t) => {
  for (const reenable of [false, true]) {
    const h = await setupRunner(
      createFakePluginHost({ ...fixtureHostOptions, agentSkillIds: ["judge"] }),
    );
    const define = h.bb.settings.define.bind(h.bb.settings);
    let pause = false;
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = t.mock.method(
      h.bb.settings,
      "define",
      (...args: Parameters<typeof define>) => {
        const settings = define(...args);
        return {
          ...settings,
          get: async () => {
            const current = await settings.get();
            if (pause) {
              entered();
              await gate;
            }
            return current;
          },
        };
      },
    );
    try {
      await registerAgentAccess(h.bb, h.api);
      await h.harness.behavior.setSettings({ enableAgentTool: true });
      pause = true;
      const args = {
        ask: { state: {}, questions: question, model: "private" },
      };
      const ctx = { threadId: "thread", projectId: "project" };
      const pending = h.harness.behavior.callAgentTool("judge_ask", args, ctx);
      await ready;
      await h.harness.behavior.setSettings({ enableAgentTool: false });
      if (reenable)
        await h.harness.behavior.setSettings({ enableAgentTool: true });
      pause = false;
      release();
      assert.equal(
        text(await pending).error.code,
        reenable ? "cancelled" : "agent_tool_disabled",
      );
      assert.equal(h.bodies.length, 0);
      assert.equal(h.repository.listRuns().length, 0);
      if (!reenable)
        assert.equal(
          text(await h.harness.behavior.callAgentTool("judge_ask", args, ctx))
            .error.code,
          "agent_tool_disabled",
        );
    } finally {
      mock.mock.restore();
      await h.harness.lifecycle.dispose();
    }
  }
});

test("fresh tool setting rejects missed revocation notifications; disposal during readiness cannot restart work", async (t) => {
  const h = await setupRunner(
    createFakePluginHost({ ...fixtureHostOptions, agentSkillIds: ["judge"] }),
  );
  const define = h.bb.settings.define.bind(h.bb.settings);
  let pause = false;
  let entered = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.mock.method(
    h.bb.settings,
    "define",
    (...args: Parameters<typeof define>) => {
      const settings = define(...args);
      return {
        ...settings,
        onChange: () => () => {},
        get: async () => {
          const value = await settings.get();
          if (pause) {
            entered();
            await gate;
          }
          return value;
        },
      };
    },
  );
  await registerAgentAccess(h.bb, h.api);
  await h.harness.behavior.setSettings({ enableAgentTool: true });
  const args = { ask: { state: {}, questions: question, model: "private" } };
  const ctx = { threadId: "thread", projectId: "project" };
  // Execution refreshes even though configure did not receive a change event.
  assert.equal(
    text(await h.harness.behavior.callAgentTool("judge_ask", args, ctx)).verdict
      .complete,
    true,
  );
  await h.harness.behavior.setSettings({ enableAgentTool: false });
  assert.equal(
    text(await h.harness.behavior.callAgentTool("judge_ask", args, ctx)).error
      .code,
    "agent_tool_disabled",
  );
  await h.harness.behavior.setSettings({ enableAgentTool: true });
  pause = true;
  const pending = h.harness.behavior.callAgentTool("judge_ask", args, ctx);
  await ready;
  await h.harness.lifecycle.dispose();
  release();
  assert.equal(text(await pending).error.code, "cancelled");
  assert.equal(h.bodies.length, 1);
  assert.equal(
    text(await h.harness.behavior.callAgentTool("judge_ask", args, ctx)).error
      .code,
    "cancelled",
  );
});

test("tool saved-set runs retain the shared whole-run budget and prevent late SDK work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const h = await setupRunner(
    createFakePluginHost({ ...fixtureHostOptions, agentSkillIds: ["judge"] }),
  );
  try {
    await registerAgentAccess(h.bb, h.api);
    await h.harness.behavior.setSettings({ enableAgentTool: true });
    const set = definition();
    set.budgetMs = 150;
    h.api.sets.save(JSON.stringify(set));
    let signal: AbortSignal | undefined;
    let release: (value: unknown) => void = () => {};
    h.harness.sdk.stub("threads.get", async (...args: unknown[]) => {
      signal = (args[0] as { signal: AbortSignal }).signal;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      now = 151;
      t.mock.timers.tick(151);
      return pending;
    });
    const result = text(
      await h.harness.behavior.callAgentTool(
        "judge_ask",
        { run: { id: "synthetic" } },
        { threadId: "thread", projectId: "project" },
      ),
    );
    assert.equal(result.verdict.complete, false);
    assert.equal(result.verdict.steps.screen.reason, "budget");
    assert.deepEqual(result.verdict.outcomes, {});
    assert.equal(signal?.aborted, true);
    release({ id: "thread", projectId: "project" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.bodies.length, 0);
    assert.equal(h.repository.listRuns().length, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
