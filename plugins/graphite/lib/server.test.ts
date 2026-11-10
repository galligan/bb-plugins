import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  type CreateFakePluginHostOptions,
} from "@get-bb/plugin-sdk/testing";

import plugin from "../server.ts";

function setup(options: CreateFakePluginHostOptions = {}) {
  return createFakePluginHost({
    pluginId: "graphite",
    sdk: {
      environments: {
        list: async () => [
          {
            id: "env",
            path: "/fixture",
            hostId: "remote",
            isGitRepo: true,
            isWorktree: false,
            branchName: "feature",
          },
        ],
      },
      plugins: {
        callRpc: async () => ({
          outcome: "available",
          workspace: {
            checkout: { kind: "branch", branchName: "feature" },
            workingTree: { state: "clean" },
          },
        }),
      },
    },
    experimental_callHostRpc: async () => ({
      outcome: "none",
      reason: "untracked",
    }),
    ...options,
  });
}

const request = { projectId: "project" };

test("real factory registers CLI, RPC and tool; invalid inputs do no host work", async (t) => {
  const { bb, harness } = setup();
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  assert.deepEqual(harness.inspection.registrations.rpcMethods, [
    "stack_current",
  ]);
  assert.equal(harness.inspection.registrations.cli?.name, "graphite");
  assert.deepEqual(
    harness.inspection.registrations.agentTools.map((tool) => tool.name),
    ["graphite_stack"],
  );
  for (const input of [null, {}, { projectId: 42 }]) {
    await assert.rejects(
      harness.behavior.callRpc("stack_current", input),
      /input/i,
    );
  }
  for (const argv of [
    ["--project"],
    ["stack", "--thread"],
    ["submit", "--json"],
    ["unknown", "--project", "project"],
  ]) {
    const result = await harness.behavior.runCli(argv);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.length > 0);
  }
  assert.equal(harness.inspection.sdk.calls.length, 0);
  assert.equal(harness.inspection.experimental_hostRpcCalls.length, 0);
});

test("RPC and CLI route reads to the environment host and reject malformed host output", async (t) => {
  const { bb, harness } = setup();
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const expected = { outcome: "none", reason: "untracked" };
  assert.deepEqual(
    await harness.behavior.callRpc("stack_current", request),
    expected,
  );
  const cli = await harness.behavior.runCli([
    "stack",
    "--json",
    "--project",
    "project",
  ]);
  assert.equal(cli.exitCode, 1);
  assert.deepEqual(JSON.parse(cli.stdout), expected);
  assert.deepEqual(
    harness.inspection.experimental_hostRpcCalls.map(
      ({ method, hostId, input }) => ({ method, hostId, input }),
    ),
    [1, 2].map(() => ({
      method: "stack",
      hostId: "remote",
      input: { repoPath: "/fixture", branchName: "feature" },
    })),
  );
  const bad = setup({
    experimental_callHostRpc: async () => ({
      outcome: "stacked",
      position: "invalid",
    }),
  });
  t.after(() => bad.harness.lifecycle.dispose());
  await plugin(bad.bb);
  assert.deepEqual(
    await bad.harness.behavior.callRpc("stack_current", request),
    {
      outcome: "unavailable",
      reason: "workspace host is unavailable",
    },
  );
});

test(
  "write CLI refuses unsafe state and forwards cancellation to the targeted host",
  { timeout: 5_000 },
  async (t) => {
    let state = "dirty_uncommitted";
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let hostSignal: AbortSignal | undefined;
    const { bb, harness } = setup({
      experimental_callHostRpc: async ({ signal }) => {
        hostSignal = signal;
        started();
        await new Promise<void>((resolve) =>
          signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
        throw new Error("cancelled");
      },
    });
    t.after(() => harness.lifecycle.dispose());
    harness.inspection.sdk.stub("plugins.callRpc", async () => ({
      outcome: "available",
      workspace: {
        checkout: { kind: "branch", branchName: "feature" },
        workingTree: { state },
      },
    }));
    await plugin(bb);
    const args = ["restack", "--project", "project"];
    const refused = await harness.behavior.runCli(args);
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /Refused: working tree is dirty_uncommitted/);
    assert.equal(harness.inspection.experimental_hostRpcCalls.length, 0);
    state = "clean";
    const controller = new AbortController();
    const pending = harness.behavior.runCli(args, {
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    const result = await pending;
    assert.equal(hostSignal?.aborted, true);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /host is unavailable/);
    assert.deepEqual(harness.inspection.experimental_hostRpcCalls[0]?.input, {
      cwd: "/fixture",
      args: ["restack"],
    });
  },
);

test("reload replaces registrations and disposal makes captured generations unusable", async (t) => {
  const first = setup({ sdk: { environments: { list: async () => [] } } });
  t.after(() => first.harness.lifecycle.dispose());
  await plugin(first.bb);
  const captured = first.harness.inspection.registrations.cli!;
  const replacement = await first.harness.lifecycle.reload(plugin);
  t.after(() => replacement.harness.lifecycle.dispose());
  assert.deepEqual(replacement.harness.inspection.registrations.rpcMethods, [
    "stack_current",
  ]);
  assert.equal(
    replacement.harness.inspection.registrations.agentTools.length,
    1,
  );
  assert.deepEqual(
    await replacement.harness.behavior.callRpc("stack_current", request),
    {
      outcome: "unavailable",
      reason: "no environment for this project",
    },
  );
  await assert.rejects(
    async () => captured.run(["stack", "--project", "project"], {}),
    /stale|disposed/i,
  );
  await replacement.harness.lifecycle.dispose();
  await assert.rejects(
    replacement.harness.behavior.callRpc("stack_current", request),
    /stale|disposed/i,
  );
});

test("RPC rejects malformed joined thread output instead of returning an invalid snapshot", async (t) => {
  const { bb, harness } = setup({
    experimental_callHostRpc: async () => ({
      outcome: "stacked",
      branch: "feature",
      position: 1,
      total: 1,
      placement: "top",
      needsRestack: false,
      isStale: false,
      warnings: [],
      branches: [
        {
          name: "feature",
          isCurrent: true,
          needsRestack: false,
          isStale: false,
          offshoots: [],
        },
      ],
    }),
  });
  t.after(() => harness.lifecycle.dispose());
  harness.inspection.sdk.stub("threads.list", async () => [
    { id: "thread", environmentId: "env", title: 42 },
  ]);
  await plugin(bb);
  await assert.rejects(
    harness.behavior.callRpc("stack_current", request),
    /output/i,
  );
  harness.inspection.sdk.stub("threads.list", async () => [
    { id: "thread", environmentId: "env", title: "Working on feature" },
  ]);
  const valid = await harness.behavior.callRpc("stack_current", request);
  assert.ok(typeof valid === "object" && valid !== null && "branches" in valid);
  assert.deepEqual(valid.branches, [
    {
      name: "feature",
      isCurrent: true,
      needsRestack: false,
      isStale: false,
      offshoots: [],
      threads: [{ id: "thread", title: "Working on feature" }],
    },
  ]);
});

test("Git RPC rejection preserves structured CLI failures and never calls the host", async (t) => {
  const { bb, harness } = setup();
  t.after(() => harness.lifecycle.dispose());
  harness.inspection.sdk.stub("plugins.callRpc", async () => {
    throw new Error("Git plugin is disabled");
  });
  await plugin(bb);
  const read = await harness.behavior.runCli([
    "stack",
    "--json",
    "--project",
    "project",
  ]);
  assert.equal(read.exitCode, 1);
  assert.deepEqual(JSON.parse(read.stdout), {
    outcome: "unavailable",
    reason: "Git workspace status is unavailable",
  });
  const textRead = await harness.behavior.runCli([
    "stack",
    "--project",
    "project",
  ]);
  assert.equal(textRead.exitCode, 1);
  assert.match(
    textRead.stdout,
    /Stack unavailable: Git workspace status is unavailable/,
  );
  const write = await harness.behavior.runCli([
    "restack",
    "--force",
    "--project",
    "project",
  ]);
  assert.equal(write.exitCode, 1);
  assert.match(write.stderr, /Git workspace status is unavailable/);
  assert.equal(harness.inspection.experimental_hostRpcCalls.length, 0);
});
