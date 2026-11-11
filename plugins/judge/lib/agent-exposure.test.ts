import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import judge from "../server.ts";
import { parseVerdict } from "./results.ts";

// Use the shipped manifest/skill names, not setupRunner's manually wired API.
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const skill = readFileSync(
  new URL("../skills/judge/SKILL.md", import.meta.url),
  "utf8",
);
const skillId = /^name:\s*(\S+)$/m.exec(skill)![1]!;
const payload = {
  ask: {
    model: "jev",
    state: { publicSynthetic: true },
    questions: {
      flag: { type: "noul", instructions: "Is publicSynthetic true?" },
    },
  },
};
const caller = { threadId: "exposure-thread", projectId: "exposure-project" };

function text(result: unknown) {
  return JSON.parse(
    (result as { content: { text: string }[] }).content[0]!.text,
  );
}

test("full factory keeps registration distinct from disabled selection and selects both surfaces on explicit enable", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("offline network tripwire");
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    agentSkillIds: [skillId],
  });
  try {
    await judge(bb);
    assert.equal(
      harness.inspection.registrations.settingsDescriptors.enableAgentTool!
        .default,
      false,
    );
    assert.equal(harness.inspection.registrations.agentTools.length, 1);
    const configuration = makePluginAgentConfigurationContext();
    const excluded =
      await harness.behavior.resolveAgentConfiguration(configuration);
    assert.deepEqual(excluded.tools, []);
    assert.deepEqual(excluded.skills, []);
    assert.equal(
      text(await harness.behavior.callAgentTool("judge_ask", payload, caller))
        .error.code,
      "agent_tool_disabled",
    );
    await harness.behavior.setSettings({ enableAgentTool: true });
    const selected =
      await harness.behavior.resolveAgentConfiguration(configuration);
    assert.deepEqual(
      selected.tools.map((tool) => tool.name),
      ["judge_ask"],
    );
    assert.deepEqual(selected.skills, [skillId]);
    assert.equal(network, 0);
    assert.equal(harness.inspection.sdk.calls.length, 0);
    assert.deepEqual(await harness.behavior.callRpc("log", {}), {
      runs: [],
      next: null,
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("full factory selects its shipped tool and skill on enabled startup across provider/session contexts", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("offline network tripwire");
  });
  assert.deepEqual(manifest.bb.skills, ["skills"]);
  assert.equal(skillId, "judge");
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    agentSkillIds: [skillId],
    settings: { enableAgentTool: true },
  });
  try {
    await judge(bb);
    assert.deepEqual(
      harness.inspection.registrations.agentTools.map((tool) => tool.name),
      ["judge_ask"],
    );
    for (const providerId of ["codex", "claude-code", "pi"]) {
      for (const origin of [
        { kind: null, pluginId: null },
        { kind: "fork" as const, pluginId: "side-chat" },
      ]) {
        const selected = await harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext({
            provider: { id: providerId },
            origin,
          }),
        );
        assert.deepEqual(selected.skills, [skillId]);
        assert.deepEqual(
          selected.tools.map((tool) => tool.name),
          ["judge_ask"],
        );
        const tool = selected.tools[0]!;
        assert.match(tool.instructions!, /exactly one of ask or run/);
        const schema = JSON.parse(JSON.stringify(tool.inputSchema));
        assert.equal(schema.type, "object");
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(schema.oneOf, [
          { required: ["ask"] },
          { required: ["run"] },
        ]);
        assert.equal(
          Object.hasOwn(schema.properties.ask.properties, "notPrivate"),
          false,
        );
        assert.equal(
          Object.hasOwn(schema.properties.run.properties, "threadId"),
          false,
        );
      }
    }
    assert.deepEqual(await harness.behavior.callRpc("models.list", {}), {
      models: [],
      defaults: { defaultId: null, privateId: null },
      next: null,
    });
    assert.equal(network, 0);
    assert.equal(harness.inspection.sdk.calls.length, 0);
    assert.ok(
      !harness.inspection.logEntries.some((entry) => entry.level === "warn"),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("enabled factory executes the exact diagnostic payload as a persisted private refusal before network, including after reload", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("offline network tripwire");
  });
  let host = createFakePluginHost({
    pluginId: "judge",
    agentSkillIds: [skillId],
    settings: {
      enableAgentTool: true,
      typesafeApiKey: "dummy-exposure-secret",
    },
  });
  try {
    await judge(host.bb);
    await host.harness.behavior.callRpc("models.add", {
      id: "jev",
      connection: "typesafe",
      model: "jev-1.13.0",
    });
    const models = await host.harness.behavior.callRpc("models.list", {});
    const oldTool = host.harness.inspection.registrations.agentTools[0]!;
    for (const reload of [false, true]) {
      if (reload) host = await host.harness.lifecycle.reload(judge);
      const selected = await host.harness.behavior.resolveAgentConfiguration(
        makePluginAgentConfigurationContext({
          thread: { id: caller.threadId },
          project: { id: caller.projectId },
          provider: { id: "codex" },
        }),
      );
      assert.deepEqual(
        selected.tools.map((tool) => tool.name),
        ["judge_ask"],
      );
      assert.deepEqual(selected.skills, [skillId]);
      assert.equal(host.harness.inspection.registrations.agentTools.length, 1);
      const result = text(
        await host.harness.behavior.callAgentTool(
          "judge_ask",
          JSON.parse(JSON.stringify(payload)),
          caller,
        ),
      );
      assert.equal(result.kind, "verdict");
      const verdict = parseVerdict(result.verdict);
      assert.equal(verdict.complete, false);
      assert.equal(verdict.threadId, caller.threadId);
      assert.equal(verdict.projectId, caller.projectId);
      assert.deepEqual(verdict.steps.main, {
        status: "unavailable",
        reason: "private_not_allowed",
        code: "private_model_required",
      });
      assert.deepEqual(
        await host.harness.behavior.callRpc("runs.get", { id: verdict.runId }),
        verdict,
      );
      assert.deepEqual(
        await host.harness.behavior.callRpc("models.list", {}),
        models,
      );
      assert.equal(network, 0);
      assert.equal(host.harness.inspection.sdk.calls.length, 0);
    }
    const stale = text(
      await oldTool.execute(payload, {
        ...caller,
        signal: new AbortController().signal,
      }),
    );
    assert.equal(stale.error.code, "cancelled");
    await host.harness.behavior.setSettings({ enableAgentTool: false });
    const disabled = await host.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    assert.deepEqual(disabled.tools, []);
    assert.deepEqual(disabled.skills, []);
    assert.equal(
      text(
        await host.harness.behavior.callAgentTool("judge_ask", payload, caller),
      ).error.code,
      "agent_tool_disabled",
    );
    assert.equal(network, 0);
    assert.ok(
      !JSON.stringify(host.harness.inspection.logEntries).includes(
        "dummy-exposure-secret",
      ),
    );
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

test("a missing shipped skill makes configuration fail closed rather than silently dropping only the tool", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    agentSkillIds: [],
    settings: { enableAgentTool: true },
  });
  try {
    await judge(bb);
    assert.equal(harness.inspection.registrations.agentTools.length, 1);
    const selected = await harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    assert.deepEqual(selected.tools, []);
    assert.deepEqual(selected.skills, []);
    assert.ok(
      harness.inspection.logEntries.some((entry) => entry.level === "warn"),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
