import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import wtPlugin from "../server.ts";

test("provider resolve receives project branch settings; absent or unreadable rows keep global behavior", async (t) => {
  const resolvedBranches: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    settings: { branchPrefix: "global/" },
    sdk: {
      system: {
        config: () => ({ generalSettings: { managedBranchPrefix: "bb/" } }),
      },
    },
    experimental_callHostRpc: ({ method, input }) => {
      if (method === "resolve") {
        if (
          typeof input === "object" &&
          input !== null &&
          "branchName" in input &&
          typeof input.branchName === "string"
        )
          resolvedBranches.push(input.branchName);
        return {
          status: "resolved",
          path: "/wt/task",
          mergeBaseBranch: "main",
        };
      }
      return { status: "created", path: "/wt/task", mergeBaseBranch: "main" };
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  const provider =
    harness.inspection.registrations.environmentProviders.get("wt");
  assert.ok(provider);
  const context: Parameters<typeof provider.create>[0] = {
    thread: makeThreadResponse({ projectId: "p" }),
    project: {
      id: "p",
      name: "Project",
      createdAt: 0,
      updatedAt: 0,
      gitRemoteUrl: null,
      kind: "standard",
    },
    host: makeHostResponse(),
    projectCheckout: { path: "/repo", experimental_ownsPath: false },
    gitRemote: null,
    inputs: {},
    suggestedBranchName: "bb/fix-login-bug-thr_1",
    pathKey: "k",
    attempt: 1,
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
    experimental_claimPath: async () => true,
  };
  await provider.create(context);
  await bb.storage.kv.set("project:p", {
    version: 1,
    branchPrefix: "project/",
  });
  await provider.create(context);
  await bb.storage.kv.set("project:p", { version: 99 });
  await provider.create(context);
  await provider.create(context);
  assert.deepEqual(resolvedBranches, [
    "global/fix-login-bug-thr_1",
    "project/fix-login-bug-thr_1",
    "global/fix-login-bug-thr_1",
    "global/fix-login-bug-thr_1",
  ]);
  assert.equal(
    harness.inspection.logEntries.filter((log) => log.level === "warn").length,
    1,
  );
});

test("project settings RPC merges individual fields and deletes a complete reset", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    sdk: {
      projects: { get: () => ({ id: "p" }) },
      system: {
        config: () => ({ generalSettings: { managedBranchPrefix: "bb/" } }),
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { branchPrefix: "p/" },
  });
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { prefixBranches: false },
  });
  assert.deepEqual(await bb.storage.kv.get("project:p"), {
    version: 1,
    branchPrefix: "p/",
    prefixBranches: false,
  });
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { branchPrefix: null, prefixBranches: null },
  });
  assert.equal(await bb.storage.kv.get("project:p"), undefined);
});

test("project picker includes personal checkouts on connected hosts", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    sdk: {
      projects: {
        list: (input) =>
          input?.includePersonal
            ? [
                {
                  id: "personal",
                  name: "Personal",
                  sources: [{ type: "local_path", hostId: "h", path: "/repo" }],
                },
              ]
            : [],
      },
      hosts: {
        list: () => [
          makeHostResponse({ id: "h", name: "Mac", status: "connected" }),
        ],
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  assert.deepEqual(await harness.behavior.callRpc("projects", {}), [
    { id: "personal", name: "Personal", hostId: "h", hostName: "Mac" },
  ]);
});

test("script-only settings survive branch resets and are passed to host resolve", async (t) => {
  const snapshots: unknown[] = [];
  const scripts = {
    setup: { mode: "custom", script: "echo project" },
    cleanup: { mode: "off", script: null },
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    sdk: {
      projects: { get: () => ({ id: "p" }) },
      system: {
        config: () => ({ generalSettings: { managedBranchPrefix: "bb/" } }),
      },
    },
    experimental_callHostRpc: ({ method, input }) => {
      if (method === "resolve") {
        if (typeof input === "object" && input !== null && "scripts" in input)
          snapshots.push(input.scripts);
        return {
          status: "resolved",
          path: "/wt/task",
          mergeBaseBranch: "main",
        };
      }
      return { status: "created", path: "/wt/task", mergeBaseBranch: "main" };
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { scripts },
  });
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { prefixBranches: null, branchPrefix: null },
  });
  const settings = await harness.behavior.callRpc("projectSettings", {
    projectId: "p",
  });
  assert.ok(
    typeof settings === "object" && settings !== null && "stored" in settings,
  );
  assert.ok(settings.stored !== null);
  const provider =
    harness.inspection.registrations.environmentProviders.get("wt");
  assert.ok(provider);
  await provider.create({
    thread: makeThreadResponse({ projectId: "p" }),
    project: {
      id: "p",
      name: "Project",
      createdAt: 0,
      updatedAt: 0,
      gitRemoteUrl: null,
      kind: "standard",
    },
    host: makeHostResponse(),
    projectCheckout: { path: "/repo", experimental_ownsPath: false },
    gitRemote: null,
    inputs: {},
    suggestedBranchName: "bb/task",
    pathKey: "k",
    attempt: 1,
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
    experimental_claimPath: async () => true,
  });
  assert.deepEqual(snapshots, [scripts]);
  await harness.behavior.callRpc("setProjectSettings", {
    projectId: "p",
    patch: { scripts: null },
  });
  assert.equal(await bb.storage.kv.get("project:p"), undefined);
});
