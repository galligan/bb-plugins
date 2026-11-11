import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { openWork } from "./storage.ts";

function fixture(t: TestContext) {
  let missingReceipt = "";
  let workerOffline = false;
  let mainOffline = false;
  let renameDuringSpawn = false;
  const env = {
    id: "env_work",
    projectId: "project_work",
    hostId: "host_work",
    status: "ready",
    hostLifecycle: "active",
    lifecycle: { phase: "active" },
  };
  const threads = new Map(
    ["thr_main", "thr_parent", "thr_monitor"].map((id) => [
      id,
      makeThreadResponse({
        id,
        projectId: id === "thr_parent" ? "project_work" : "project_home",
      }),
    ]),
  );
  let current: ReturnType<typeof createFakePluginHost>;
  let store: ReturnType<typeof openSetup>;
  let work: ReturnType<typeof openWork>;
  let configured = 0;
  const metadata = new Map<string, unknown>();
  const host = createFakePluginHost({
    pluginId: "bbots",
    agentSkillIds: ["bbots", "bbots-soul"],
    experimental_hostEntry: true,
    experimental_callHostRpc: async () => ({ status: "present" }),
    sdk: {
      hosts: {
        get: async ({ hostId }) =>
          makeHostResponse({
            id: hostId,
            status: (hostId === "host_home" ? mainOffline : workerOffline)
              ? "disconnected"
              : "connected",
          }),
      },
      environments: { get: async () => env },
      threads: {
        getPluginMetadata: async ({ threadId }) => metadata.get(threadId) ?? {},
        update: async (args) => {
          const thread = {
            ...threads.get(args.threadId)!,
            ...(args.title ? { title: args.title } : {}),
          };
          threads.set(thread.id, thread);
          return thread;
        },
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Missing thread");
          return thread;
        },
        spawn: async (args) => {
          if (missingReceipt === "before")
            throw new Error("Lost pre-admission receipt");
          if (renameDuringSpawn) {
            const lookup = args.pluginMetadata as { conversationId: string };
            const owner = store.conversations.get(lookup.conversationId);
            store.profiles.rename({
              botId: owner.botId,
              name: "Robert",
              expectedRevision: 1,
              author: "fixture-user",
              reason: "Concurrent explicit rename",
            });
          }
          const thread = makeThreadResponse({
            id: `thr_worker_${configured}`,
            projectId: args.projectId,
            environmentId: null,
            title: args.title ?? null,
            originPluginId: "bbots",
            parentThreadId: args.parentThreadId ?? null,
          });
          const decision = await current.harness.inspection.registrations.hooks[
            "message.dispatch"
          ]!(
            makeMessageDispatchHookContext({
              thread,
              project: { id: args.projectId },
              environment: null,
              environmentIntent: {
                kind: "environment",
                environmentId: "env_work",
              },
              host: { id: "host_work", status: "connected" },
              origin: "plugin",
              originPluginId: "bbots",
              experimental_submission: args.pluginSubmission ?? null,
            }),
          );
          assert.equal(decision.action, "proceed");
          const owner = store.conversations.ownerOfThread(thread.id);
          assert.equal(owner?.role, "worker");
          assert.equal(work.get(owner!.id).phase, "bound");
          assert.equal(
            work.agreement(owner!.id).agreement.assignment,
            "Investigate the issue",
          );
          const config =
            await current.harness.behavior.resolveAgentConfiguration(
              makePluginAgentConfigurationContext({
                thread: { id: thread.id },
              }),
            );
          assert.match(config.instructions ?? "", /role worker/);
          configured++;
          threads.set(thread.id, { ...thread, environmentId: "env_work" });
          if (missingReceipt === "after")
            throw new Error("Lost post-admission receipt");
          return thread;
        },
      },
    },
  });
  current = host;
  t.after(() => current.harness.lifecycle.dispose());
  plugin(host.bb);
  store = openSetup(host.bb.storage);
  work = openWork(host.bb.storage, store);
  const setup = store.plan({
    requestId: randomUUID(),
    hostId: "host_home",
    name: "Bob",
    associations: { mode: "none" },
  });
  store.setHome(setup.botId, "/home/bob");
  store.setProject(setup.botId, "project_home");
  store.phase(setup.botId, "project-ready", "spawning");
  store.bind(setup.botId, "thr_main");
  store.phase(setup.botId, "owned", "ready");
  const requestId = randomUUID();
  const args = [
    "work",
    "Investigate the issue",
    "--bot",
    setup.botId,
    "--title",
    "Investigate",
    "--project",
    "project_work",
    "--environment",
    "env_work",
    "--report-thread",
    "thr_monitor",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit investigation",
    "--request-id",
    requestId,
    "--json",
  ];
  return {
    get harness() {
      return current.harness;
    },
    store,
    work,
    setup,
    env,
    args,
    threads,
    metadata,
    get configured() {
      return configured;
    },
    lose: (phase: string) => {
      missingReceipt = phase;
    },
    offlineWorker: () => {
      workerOffline = true;
    },
    offlineMain: () => {
      mainOffline = true;
    },
    renameDuringCreation: () => {
      renameDuringSpawn = true;
    },
    reload: async () => {
      current = await current.harness.lifecycle.reload(plugin);
    },
  };
}

test("owned worker binds before session configuration, independently of its native parent and report target", async (t) => {
  const f = fixture(t);
  f.offlineMain();
  const result = await f.harness.behavior.runCli(f.args, {
    threadId: "thr_main",
  });
  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout);
  assert.equal(view.conversation.role, "worker");
  assert.equal(view.setup.phase, "bound");
  assert.equal(view.setup.request.parentThreadId, undefined);
  assert.equal(f.configured, 1);
  const [args] = f.harness.inspection.sdk.callsTo("threads.spawn");
  assert.deepEqual((args![0] as { environment: unknown }).environment, {
    type: "reuse",
    environmentId: "env_work",
  });
  assert.equal((args![0] as { title: string }).title, "→ @Bob Investigate");
  assert.equal(
    (args![0] as { parentNotifications: string }).parentNotifications,
    "off",
  );
  assert.equal(
    (args![0] as { senderThreadId: string }).senderThreadId,
    "thr_main",
  );
  assert.equal(view.contract.agreement.reportTo.threadId, "thr_monitor");
});

test("optional native parent is independent of the explicit non-main report destination", async (t) => {
  const f = fixture(t);
  const result = await f.harness.behavior.runCli(
    [...f.args, "--parent", "thr_parent"],
    { threadId: "thr_main" },
  );
  assert.equal(result.exitCode, 0);
  const [args] = f.harness.inspection.sdk.callsTo("threads.spawn");
  assert.equal(
    (args![0] as { parentThreadId: string }).parentThreadId,
    "thr_parent",
  );
  assert.equal(
    JSON.parse(result.stdout).contract.agreement.reportTo.threadId,
    "thr_monitor",
  );
});

test("an owned caller cannot create work for a different bot", async (t) => {
  const f = fixture(t);
  const alice = f.store.plan({
    requestId: randomUUID(),
    hostId: "host_other",
    name: "Alice",
    associations: { mode: "none" },
  });
  const args = [...f.args];
  args[args.indexOf("--bot") + 1] = alice.botId;
  assert.equal(
    (await f.harness.behavior.runCli(args, { threadId: "thr_main" })).exitCode,
    1,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.deepEqual(f.work.list(alice.botId), { workers: [], hasMore: false });
});

test("unknown pre-admission creation never respawns after reload or identical request replay", async (t) => {
  const f = fixture(t);
  f.lose("before");
  let result = await f.harness.behavior.runCli(f.args);
  assert.equal(result.exitCode, 1);
  const view = JSON.parse(result.stdout);
  assert.equal(view.setup.phase, "spawning");
  assert.equal(view.conversation.threadId, null);
  await f.reload();
  result = await f.harness.behavior.runCli(f.args);
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.stdout).conversation.id, view.conversation.id);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("an ordinary human follow-up to a pending owned creation still binds before configuration", async (t) => {
  const f = fixture(t);
  f.lose("before");
  const pending = JSON.parse((await f.harness.behavior.runCli(f.args)).stdout);
  const thread = makeThreadResponse({
    id: "thr_pending_user",
    originPluginId: "bbots",
    projectId: "project_work",
    environmentId: null,
  });
  f.metadata.set(thread.id, {
    kind: "worker",
    conversationId: pending.conversation.id,
    requestId: pending.setup.requestId,
  });
  const decision = await f.harness.inspection.registrations.hooks[
    "message.dispatch"
  ]!(
    makeMessageDispatchHookContext({
      thread,
      project: { id: "project_work" },
      environment: null,
      environmentIntent: { kind: "environment", environmentId: "env_work" },
      host: { id: "host_work", status: "connected" },
      origin: "app",
      originPluginId: null,
      experimental_submission: null,
    }),
  );
  assert.equal(decision.action, "proceed");
  assert.equal(
    f.store.conversations.ownerOfThread(thread.id)?.id,
    pending.conversation.id,
  );
  const config = await f.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({ thread: { id: thread.id } }),
  );
  assert.match(config.instructions ?? "", /role worker/);
});

test("lost receipt after admission preserves the bound worker without rerunning the assignment", async (t) => {
  const f = fixture(t);
  f.lose("after");
  const first = await f.harness.behavior.runCli(f.args);
  const view = JSON.parse(first.stdout);
  assert.equal(view.setup.phase, "bound");
  assert.ok(view.conversation.threadId);
  assert.equal(f.configured, 1);
  await f.reload();
  const next = await f.harness.behavior.runCli(f.args);
  assert.equal(
    JSON.parse(next.stdout).conversation.threadId,
    view.conversation.threadId,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(f.configured, 1);
});

test("offline, retired or wrong-project environment refuses work before immutable intent or native spawn", async (t) => {
  const f = fixture(t);
  f.env.projectId = "wrong_project";
  assert.equal((await f.harness.behavior.runCli(f.args)).exitCode, 1);
  f.env.projectId = "project_work";
  f.env.lifecycle.phase = "retiring";
  assert.equal((await f.harness.behavior.runCli(f.args)).exitCode, 1);
  f.env.lifecycle.phase = "active";
  f.offlineWorker();
  assert.equal((await f.harness.behavior.runCli(f.args)).exitCode, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.deepEqual(
    f.work.findRequest(f.args[f.args.indexOf("--request-id") + 1]!),
    null,
  );
});

test("future worker execution inherits main defaults without widening permissions or enabling fallback", async (t) => {
  const f = fixture(t);
  const defaults = {
    main: {
      providerId: "codex",
      model: "worker-model",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      serviceTier: "default",
    },
    worker: null,
    fallback: null,
  };
  const saved = await f.harness.behavior.runCli([
    "models",
    "update",
    f.setup.botId,
    "--revision",
    "0",
    "--defaults",
    JSON.stringify(defaults),
    "--author",
    "fixture-user",
    "--reason",
    "Future workers",
  ]);
  assert.equal(saved.exitCode, 0);
  assert.equal((await f.harness.behavior.runCli(f.args)).exitCode, 0);
  const [call] = f.harness.inspection.sdk.callsTo("threads.spawn");
  const args = call![0] as typeof defaults.main;
  for (const [key, value] of Object.entries(defaults.main))
    assert.equal(args[key as keyof typeof args], value);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});

test("explicit bot rename updates worker managed title without moving ownership or fighting manual title/pin on ordinary resume", async (t) => {
  const f = fixture(t);
  const created = JSON.parse((await f.harness.behavior.runCli(f.args)).stdout);
  const threadId = created.conversation.threadId;
  const native = f.threads.get(threadId)!;
  f.threads.set(threadId, {
    ...native,
    title: "Manual task title",
    pinnedAt: null,
  });
  assert.equal(
    (await f.harness.behavior.runCli(["resume", f.setup.botId])).exitCode,
    0,
  );
  assert.equal(f.threads.get(threadId)!.title, "Manual task title");
  const renamed = await f.harness.behavior.runCli([
    "rename",
    f.setup.botId,
    "--name",
    "Robert",
    "--revision",
    "1",
  ]);
  assert.equal(renamed.exitCode, 0);
  assert.equal(f.threads.get(threadId)!.title, "→ @Robert Investigate");
  assert.equal(f.threads.get(threadId)!.pinnedAt, null);
  assert.equal(
    f.store.conversations.get(created.conversation.id).threadId,
    threadId,
  );
  assert.deepEqual(
    f.work.agreement(created.conversation.id).agreement.reportTo,
    { kind: "thread", threadId: "thr_monitor" },
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
});

test("a rename during creation exposes its pending managed title without replaying the assignment", async (t) => {
  const f = fixture(t);
  f.renameDuringCreation();
  const result = await f.harness.behavior.runCli(f.args);
  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout);
  assert.equal(view.managedTitlePending, true);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  const resumed = await f.harness.behavior.runCli(["resume", f.setup.botId]);
  assert.equal(resumed.exitCode, 0);
  assert.equal(f.work.titlePending(view.conversation.id), false);
  assert.equal(
    f.threads.get(view.conversation.threadId)!.title,
    "→ @Robert Investigate",
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
});
