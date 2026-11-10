import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { currentStack, resolveEnvironment } from "./current-stack.ts";
import { runVerb } from "./verbs.ts";

function bbWithEnvironments(
  environments: Array<{ id: string; isWorktree?: boolean }>,
  threadEnvironmentId: string | null,
  onHostCall?: (method: string, hostId: string) => void,
  status?: unknown,
): BbPluginApi {
  const bb = {
    sdk: {
      environments: {
        list: async () =>
          environments.map((environment) => ({
            id: environment.id,
            path: "/tmp/graphite-test",
            hostId: "host-1",
            isWorktree: environment.isWorktree ?? false,
            isGitRepo: true,
          })),
      },
      plugins: {
        callRpc: async (request: {
          pluginId: string;
          method: string;
          input: unknown;
          outputSchema: { parse(value: unknown): unknown };
        }) => {
          assert.equal(request.pluginId, "bb--git");
          assert.equal(request.method, "workspaceStatus");
          assert.ok(
            environments.some(
              (environment) =>
                JSON.stringify(request.input) ===
                JSON.stringify({ environmentId: environment.id }),
            ),
          );
          if (status instanceof Error) throw status;
          return request.outputSchema.parse(
            status ?? {
              outcome: "available",
              workspace: {
                checkout: { kind: "branch", branchName: "feature" },
                workingTree: { state: "clean" },
              },
            },
          );
        },
      },
      threads: {
        list: async () => [],
        get: async () => {
          if (threadEnvironmentId === null) throw new Error("not found");
          return { environmentId: threadEnvironmentId };
        },
      },
    },
    hosts: {
      experimental_client: () => ({
        call: async (
          method: string,
          _input: unknown,
          options: { hostId: string },
        ) => {
          onHostCall?.(method, options.hostId);
          if (method === "stack") {
            return {
              outcome: "stacked",
              branch: "feature",
              position: 2,
              total: 2,
              placement: "top",
              needsRestack: false,
              isStale: false,
              warnings: [],
              branches: [],
            };
          }
          return { outcome: "ran", exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    },
  };
  // The test supplies only the SDK methods exercised by resolution.
  return bb as unknown as BbPluginApi;
}

describe("environment targeting", () => {
  it("refuses an explicit thread that cannot be found", async () => {
    const result = await resolveEnvironment(
      bbWithEnvironments([{ id: "first" }], null),
      {
        projectId: "project",
        threadId: "missing",
      },
    );
    assert.deepEqual(result, {
      outcome: "unavailable",
      reason: "thread missing was not found",
    });
  });

  it("refuses a thread from another project instead of selecting the first environment", async () => {
    const result = await resolveEnvironment(
      bbWithEnvironments([{ id: "first" }], "other"),
      {
        projectId: "project",
        threadId: "other-thread",
      },
    );
    assert.deepEqual(result, {
      outcome: "unavailable",
      reason: "thread is not in this project's environments",
    });
  });

  it("requires a thread when a project has multiple environments", async () => {
    const result = await resolveEnvironment(
      bbWithEnvironments([{ id: "first" }, { id: "second" }], null),
      { projectId: "project" },
    );
    assert.deepEqual(result, {
      outcome: "unavailable",
      reason: "project has multiple environments; pass --thread <id>",
    });
  });

  it("refuses sync in a worktree before invoking Graphite", async () => {
    const result = await runVerb(
      bbWithEnvironments([{ id: "worktree", isWorktree: true }], "worktree"),
      { projectId: "project", threadId: "thread", verb: "sync" },
    );
    assert.deepEqual(result, {
      outcome: "refused",
      reason: "gt sync cannot run in a git worktree; fetch and restack instead",
    });
  });

  it("runs Graphite on the environment's host", async () => {
    const calls: string[] = [];
    const bb = bbWithEnvironments(
      [{ id: "remote" }],
      "remote",
      (method, hostId) => {
        calls.push(`${method}:${hostId}`);
      },
    );
    const stack = await currentStack(bb, {
      projectId: "project",
      threadId: "thread",
    });
    assert.equal(stack.outcome, "stacked");
    const verb = await runVerb(bb, {
      projectId: "project",
      threadId: "thread",
      verb: "restack",
    });
    assert.equal(verb.outcome, "ran");
    assert.deepEqual(calls, ["stack:host-1", "gt:host-1"]);
  });
});

describe("Git plugin status contract", () => {
  it("fails closed for unavailable and unknown checkout states", async () => {
    for (const status of [
      { outcome: "unavailable" },
      { outcome: "not_applicable" },
      {
        outcome: "available",
        workspace: {
          checkout: { kind: "unknown" },
          workingTree: { state: "clean" },
        },
      },
      {
        outcome: "available",
        workspace: {
          checkout: { kind: "detached" },
          workingTree: { state: "clean" },
        },
      },
    ]) {
      const result = await resolveEnvironment(
        bbWithEnvironments([{ id: "env" }], "env", undefined, status),
        { projectId: "project", threadId: "thread" },
      );
      assert.equal(result.outcome, "unavailable");
    }
  });
  it("returns structured failures for malformed Git output before any host call", async () => {
    const bb = bbWithEnvironments(
      [{ id: "env" }],
      "env",
      () => assert.fail("host must not run"),
      {
        outcome: "available",
        workspace: {
          checkout: { kind: "branch", branchName: "feature" },
          workingTree: {},
        },
      },
    );
    assert.deepEqual(
      await currentStack(bb, { projectId: "project", threadId: "thread" }),
      { outcome: "unavailable", reason: "Git workspace status is unavailable" },
    );
  });
});

it("Git RPC rejection returns read and write failures without invoking the host", async () => {
  const bb = bbWithEnvironments(
    [{ id: "env" }],
    "env",
    () => assert.fail("no host calls"),
    new Error("RPC unavailable"),
  );
  const request = { projectId: "project", threadId: "thread" };
  assert.deepEqual(await currentStack(bb, request), {
    outcome: "unavailable",
    reason: "Git workspace status is unavailable",
  });
  assert.deepEqual(
    await runVerb(bb, { ...request, verb: "restack", force: true }),
    { outcome: "unavailable", reason: "Git workspace status is unavailable" },
  );
});
