import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "./storage.ts";
import { viewSchema, createSchema } from "./contracts.ts";

function fixture(t: TestContext) {
  let missing = false,
    offline = false,
    spawnFailure = false,
    lostAfterAdmission = false,
    lostProjectReceipt = false,
    missingThread = false,
    movedThread = false,
    invalidBase = false;
  let thread = makeThreadResponse({
    id: "thr_main",
    projectId: "proj_home",
    title: "@Bob",
    originPluginId: "bbots",
  });
  const project = {
    id: "proj_home",
    name: "Bots: Bob",
    kind: "standard" as const,
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
    sources: [
      {
        id: "source_home",
        type: "local_path" as const,
        hostId: "host_test",
        path: "/safe/home",
        projectId: "proj_home",
        createdAt: 0,
        updatedAt: 0,
        isDefault: true,
      },
    ],
  };
  const projects: (typeof project)[] = [];
  const threads = new Map<string, typeof thread>();
  let current: ReturnType<typeof createFakePluginHost>;
  const host = createFakePluginHost({
    pluginId: "bbots",
    agentSkillIds: ["bbots", "bbots-soul"],
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "validateBase") {
        if (invalidBase) throw new Error("Wrong platform home base");
        return { path: "/safe/homes" };
      }
      return call.method === "prepare"
        ? {
            path: `/safe/homes/${(call.input as { botId: string }).botId}`,
            status: "created",
          }
        : { status: missing ? "missing" : "present" };
    },
    sdk: {
      hosts: {
        get: async () =>
          makeHostResponse({
            id: "host_test",
            status: offline ? "disconnected" : "connected",
          }),
      },
      projects: {
        list: async () => projects,
        create: async (args) => {
          const id = projects.length
            ? `proj_home_${projects.length}`
            : "proj_home";
          const created = {
            ...project,
            id,
            name: args.name,
            sources: [
              {
                ...project.sources[0]!,
                projectId: id,
                path: args.source.path,
                hostId: args.source.hostId,
              },
            ],
          };
          projects.push(created);
          if (lostProjectReceipt) throw new Error("Lost project receipt");
          return created;
        },
      },
      threads: {
        spawn: async (args) => {
          if (spawnFailure) throw new Error("Lost spawn receipt");
          thread = makeThreadResponse({
            ...thread,
            id: threads.size ? `thr_main_${threads.size}` : "thr_main",
            projectId: args.projectId,
            title: args.title ?? null,
          });
          threads.set(thread.id, thread);
          const base = makeMessageDispatchHookContext();
          const decision = await current.harness.inspection.registrations.hooks[
            "message.dispatch"
          ]!({
            ...base,
            thread,
            project: { ...base.project, id: args.projectId },
            host: makeHostResponse({ id: "host_test", status: "connected" }),
            origin: "plugin",
            originPluginId: "bbots",
            experimental_submission: args.pluginSubmission ?? null,
          });
          assert.equal(decision.action, "proceed");
          assert.equal(
            openSetup(current.bb.storage).conversations.ownerOfThread(thread.id)
              ?.botId,
            (args.pluginMetadata as { botId: string }).botId,
          );
          const config = makePluginAgentConfigurationContext();
          config.thread.id = thread.id;
          const resolved =
            await current.harness.behavior.resolveAgentConfiguration(config);
          assert.match(resolved.instructions ?? "", /persistent bot identity/);
          if (lostAfterAdmission)
            throw new Error("Lost receipt after ownership");
          return thread;
        },
        get: async (args) => {
          if (missingThread) throw new Error("Not found");
          const value = threads.get(args.threadId)!;
          return movedThread
            ? { ...value, projectId: "foreign_project" }
            : value;
        },
        update: async (args) => {
          thread = {
            ...threads.get(args.threadId)!,
            title: args.title ?? threads.get(args.threadId)!.title,
          };
          threads.set(thread.id, thread);
          return thread;
        },
      },
    },
  });
  current = host;
  t.after(() => current.harness.lifecycle.dispose());
  plugin(current.bb);
  return {
    get bb() {
      return current.bb;
    },
    get harness() {
      return current.harness;
    },
    reload: async () => {
      current = await current.harness.lifecycle.reload(plugin);
    },
    store: openSetup(host.bb.storage),
    input: createSchema.parse({ requestId: randomUUID(), hostId: "host_test" }),
    setMissing: (x: boolean) => {
      missing = x;
    },
    setOffline: (x: boolean) => {
      offline = x;
    },
    setInvalidBase: (value: boolean) => {
      invalidBase = value;
    },
    setMissingThread: () => {
      missingThread = true;
    },
    setMovedThread: () => {
      movedThread = true;
    },
    preExistingProject: (botId: string) => {
      projects.push({
        ...project,
        id: "foreign_project",
        sources: [
          {
            ...project.sources[0]!,
            projectId: "foreign_project",
            path: `/safe/homes/${botId}`,
          },
        ],
      });
    },
    setLostAfterAdmission: () => {
      lostAfterAdmission = true;
    },
    setProjectReceiptLoss: () => {
      lostProjectReceipt = true;
    },
    manualTitle: () => {
      thread = { ...thread, title: "A manually chosen title", pinnedAt: null };
      threads.set(thread.id, thread);
    },
    setSpawnFailure: () => {
      spawnFailure = true;
    },
  };
}

test("real server creation binds ownership before configure, replays idempotently and never repins on resume", async (t) => {
  const f = fixture(t);
  const created = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  assert.equal(created.setup.phase, "ready");
  assert.equal(created.main.threadId, "thr_main");
  assert.equal(created.setup.error, null);
  const spawn = f.harness.inspection.sdk.callsTo("threads.spawn");
  assert.equal(spawn.length, 1);
  assert.equal((spawn[0]![0] as { pinned: boolean }).pinned, true);
  assert.equal(
    (spawn[0]![0] as { permissionMode?: string }).permissionMode,
    undefined,
  );
  assert.equal(
    (spawn[0]![0] as { parentThreadId?: string }).parentThreadId,
    undefined,
  );
  assert.deepEqual(
    viewSchema.parse(await f.harness.behavior.callRpc("create", f.input)),
    created,
  );
  await f.harness.behavior.callRpc("resume", { botId: created.bot.id });
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.pin").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  await assert.rejects(
    f.harness.behavior.callRpc("create", { ...f.input, name: "Another" }),
    /already used/,
  );
});

test("new main uses native explicit reasoning/permission choices and revised defaults after offline setup", async (t) => {
  const f = fixture(t);
  f.setOffline(true);
  const planned = viewSchema.parse(
    await f.harness.behavior.callRpc("create", {
      ...f.input,
      providerId: "codex",
      model: "initial-model",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
    }),
  );
  await f.harness.behavior.callRpc("defaultsUpdate", {
    botId: planned.bot.id,
    expectedRevision: 0,
    defaults: {
      main: {
        providerId: "codex",
        model: "chosen-model",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
        serviceTier: "fast",
      },
      worker: null,
      fallback: null,
    },
    author: "fixture-user",
    reason: "Explicit model choice",
  });
  f.setOffline(false);
  const ready = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: planned.bot.id }),
  );
  assert.equal(ready.setup.phase, "ready");
  const args = f.harness.inspection.sdk.callsTo(
    "threads.spawn",
  )[0]![0] as Record<string, unknown>;
  assert.equal(args.model, "chosen-model");
  assert.equal(args.reasoningLevel, "high");
  assert.equal(args.permissionMode, "accept-edits");
  assert.equal(args.serviceTier, "fast");
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});

test("host validation refuses a new request before immutable creation intent and allows explicit correction", async (t) => {
  const f = fixture(t);
  f.setInvalidBase(true);
  await assert.rejects(
    f.harness.behavior.callRpc("create", { ...f.input, homeBase: "C:\\bots" }),
    /before saving creation intent/,
  );
  assert.deepEqual(f.store.list().bots, []);
  assert.equal(f.store.findRequest(f.input.requestId), null);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  f.setInvalidBase(false);
  const corrected = viewSchema.parse(
    await f.harness.behavior.callRpc("create", {
      ...f.input,
      homeBase: "/valid/base",
    }),
  );
  assert.equal(corrected.setup.phase, "ready");
  assert.equal(f.store.list().bots.length, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
});

test("rename preserves home, logical/physical IDs and applies the title only on explicit change", async (t) => {
  const f = fixture(t);
  const before = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  const after = viewSchema.parse(
    await f.harness.behavior.callRpc("rename", {
      botId: before.bot.id,
      expectedRevision: 1,
      name: "Robert",
    }),
  );
  assert.equal(after.bot.id, before.bot.id);
  assert.equal(after.main.id, before.main.id);
  assert.equal(after.main.threadId, before.main.threadId);
  assert.equal(after.setup.homePath, before.setup.homePath);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.update").length, 1);
  await f.harness.behavior.callRpc("resume", { botId: before.bot.id });
  assert.equal(f.harness.inspection.sdk.callsTo("threads.update").length, 1);
  await assert.rejects(
    f.harness.behavior.callRpc("rename", {
      botId: before.bot.id,
      expectedRevision: 1,
      name: "Stale",
    }),
    /changed/,
  );
});

test("offline partial setup survives reload; missing established home never invokes prepare again", async (t) => {
  const f = fixture(t);
  f.setOffline(true);
  const pending = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  assert.match(pending.setup.error ?? "", /offline/);
  assert.equal(pending.setup.phase, "planned");
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  f.setOffline(false);
  await f.reload();
  const ready = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: pending.bot.id }),
  );
  assert.equal(ready.setup.phase, "ready");
  const prepareCount = f.harness.inspection.experimental_hostRpcCalls.filter(
    (c) => c.method === "prepare",
  ).length;
  f.setMissing(true);
  const missing = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: ready.bot.id }),
  );
  assert.match(missing.setup.error ?? "", /missing/);
  assert.equal(
    f.harness.inspection.experimental_hostRpcCalls.filter(
      (c) => c.method === "prepare",
    ).length,
    prepareCount,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
});

test("uncertain spawn is durable and refuses automatic duplicate creation after reload", async (t) => {
  const f = fixture(t);
  f.setSpawnFailure();
  const failed = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  assert.equal(failed.setup.phase, "spawning");
  const priorSpawns = f.harness.inspection.sdk.callsTo("threads.spawn").length;
  await f.reload();
  const resumed = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: failed.bot.id }),
  );
  assert.match(resumed.setup.error ?? "", /uncertain/);
  assert.equal(priorSpawns, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("forged metadata cannot adopt an unrelated conversation; archived lifecycle never deletes homes", async (t) => {
  const f = fixture(t);
  const base = makeMessageDispatchHookContext();
  const decision = await f.harness.inspection.registrations.hooks[
    "message.dispatch"
  ]!({
    ...base,
    thread: { ...base.thread, originPluginId: "bbots" },
    origin: "plugin",
    originPluginId: "bbots",
    experimental_submission: {
      pluginId: "bbots",
      data: { botId: "invented", requestId: randomUUID() },
    },
  });
  assert.equal(decision.action, "reject");
  assert.equal(f.store.conversations.ownerOfThread(base.thread.id), null);
  const explicitCommunication = await f.harness.inspection.registrations.hooks[
    "message.dispatch"
  ]!({ ...base, origin: "plugin", originPluginId: "bbots" });
  assert.equal(explicitCommunication.action, "proceed");
  assert.equal(f.store.conversations.ownerOfThread(base.thread.id), null);
  const unrelated =
    await f.harness.inspection.registrations.hooks["message.dispatch"]!(base);
  assert.equal(unrelated.action, "proceed");
  await f.harness.behavior.emitThreadEvent("thread.archived", {
    thread: makeThreadResponse(),
  });
  assert.equal(f.harness.inspection.experimental_hostRpcCalls.length, 0);
});

test("lost spawn receipt after admission recovers the existing main and preserves manual title/unpin", async (t) => {
  const f = fixture(t);
  f.setLostAfterAdmission();
  const pending = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  assert.equal(pending.setup.phase, "owned");
  assert.equal(pending.main.threadId, "thr_main");
  f.manualTitle();
  await f.reload();
  const recovered = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: pending.bot.id }),
  );
  assert.equal(recovered.setup.phase, "ready");
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.update").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.pin").length, 0);
});

test("uncertain project receipt never adopts an unrecorded project or creates a duplicate", async (t) => {
  const f = fixture(t);
  f.setProjectReceiptLoss();
  const pending = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  assert.equal(pending.setup.phase, "project-creating");
  await f.reload();
  const recovered = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: pending.bot.id }),
  );
  assert.equal(recovered.setup.phase, "project-creating");
  assert.match(recovered.setup.error ?? "", /uncertain/);
  assert.equal(f.harness.inspection.sdk.callsTo("projects.create").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("owned dispatch refuses a missing home and idle/failed events never restart work", async (t) => {
  const f = fixture(t);
  const created = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  f.setMissing(true);
  const context = makeMessageDispatchHookContext();
  const blocked = await f.harness.inspection.registrations.hooks[
    "message.dispatch"
  ]!({
    ...context,
    thread: makeThreadResponse({ id: created.main.threadId! }),
  });
  assert.equal(blocked.action, "reject");
  await f.harness.behavior.emitThreadEvent("thread.idle", {
    thread: makeThreadResponse({ id: created.main.threadId! }),
    lastAssistantText: "Stopped",
  });
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});

test("two bots keep distinct homes, mains and souls; association scope never selects the main workspace", async (t) => {
  const f = fixture(t);
  const first = viewSchema.parse(
    await f.harness.behavior.callRpc("create", {
      ...f.input,
      associations: { mode: "all" },
    }),
  );
  const second = viewSchema.parse(
    await f.harness.behavior.callRpc("create", {
      ...f.input,
      requestId: randomUUID(),
      name: "Alice",
      associations: { mode: "selected", projectIds: ["repo_project"] },
    }),
  );
  assert.equal(first.setup.phase, "ready");
  assert.equal(second.setup.phase, "ready");
  assert.notEqual(first.bot.id, second.bot.id);
  assert.notEqual(first.main.threadId, second.main.threadId);
  assert.notEqual(first.setup.homePath, second.setup.homePath);
  for (const call of f.harness.inspection.sdk.callsTo("threads.spawn")) {
    const args = call[0] as {
      projectId: string;
      environment: { workspace: { path: string } };
      pluginMetadata: { botId: string };
    };
    const owned = f.store.view(args.pluginMetadata.botId);
    assert.equal(args.projectId, owned.setup.projectId);
    assert.equal(args.environment.workspace.path, owned.setup.homePath);
  }
  assert.equal(
    f.store.view(first.bot.id).setup.request.associations.mode,
    "all",
  );
  assert.equal(
    f.store.view(second.bot.id).setup.request.associations.mode,
    "selected",
  );
});

test("ready resume reports a missing or moved main without replacement", async (t) => {
  const f = fixture(t);
  const ready = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  f.setMissingThread();
  const missing = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: ready.bot.id }),
  );
  assert.match(missing.setup.error ?? "", /unavailable/);
  assert.equal(missing.main.threadId, ready.main.threadId);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
});

test("ready resume rejects main project drift and pre-existing home sources are not adopted", async (t) => {
  const f = fixture(t);
  const ready = viewSchema.parse(
    await f.harness.behavior.callRpc("create", f.input),
  );
  f.setMovedThread();
  const moved = viewSchema.parse(
    await f.harness.behavior.callRpc("resume", { botId: ready.bot.id }),
  );
  assert.match(moved.setup.error ?? "", /removed or moved/);
  const other = createSchema.parse({
    ...f.input,
    requestId: randomUUID(),
    name: "Other",
  });
  const planned = f.store.plan(other);
  f.preExistingProject(planned.botId);
  const conflict = viewSchema.parse(
    await f.harness.behavior.callRpc("create", other),
  );
  assert.match(conflict.setup.error ?? "", /pre-existing/);
  assert.equal(conflict.setup.projectId, null);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("projects.create").length, 1);
});
