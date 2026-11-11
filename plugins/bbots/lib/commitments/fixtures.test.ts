import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { PluginCliContext } from "@get-bb/plugin-sdk";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { openWork } from "../work/storage.ts";
import { workSchema } from "../work/contracts.ts";

export function fixture(t: TestContext) {
  let offline = false;
  let beforeTaskReply: (() => Promise<void>) | undefined;
  const tasks = new Map([
    [
      "task_one",
      {
        id: "task_one",
        projectId: "tracker_owned",
        key: "OWN-1",
        title: "Source task",
        status: "todo",
      },
    ],
    [
      "task_two",
      {
        id: "task_two",
        projectId: "tracker_owned",
        key: "OWN-2",
        title: "Replacement reference",
        status: "done",
      },
    ],
    [
      "task_foreign",
      {
        id: "task_foreign",
        projectId: "tracker_other",
        key: "OTHER-1",
        title: "Other board",
        status: "done",
      },
    ],
  ]);
  let current = createFakePluginHost({
    pluginId: "bbots",
    sdk: {
      plugins: {
        callRpc: async ({ method, input, outputSchema }) => {
          if (offline) throw new Error("Tasks is offline");
          if (method === "listProjects")
            return outputSchema.parse({
              projects: [{ id: "tracker_owned", name: "Owned", prefix: "OWN" }],
            });
          assert.equal(
            method,
            "getTask",
            "commitment commands never mutate Tasks",
          );
          const reply = outputSchema.parse({
            task: tasks.get((input as { taskId: string }).taskId) ?? null,
          });
          const pause = beforeTaskReply;
          beforeTaskReply = undefined;
          await pause?.();
          return reply;
        },
      },
    },
  });
  plugin(current.bb);
  let store = openSetup(current.bb.storage);
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
  store.documents.write({
    botId: setup.botId,
    name: "TASKS.json",
    expectedRevision: 0,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "ready",
      boardId: "tracker_owned",
    }),
    author: "fixture-user",
    reason: "Configured source",
  });
  const work = openWork(current.bb.storage, store);
  const worker = work.plan(
    workSchema.parse({
      requestId: randomUUID(),
      botId: setup.botId,
      title: "Owned work",
      projectId: "project_home",
      environmentId: "env_work",
      author: "fixture-user",
      reason: "Owned caller fixture",
      agreement: {
        assignment: "Own the obligation",
        reportTo: {
          kind: "conversation",
          conversationId: setup.conversationId,
        },
      },
    }),
  );
  work.start(worker.conversationId);
  work.bind(worker.conversationId, "thr_worker");
  t.after(() => current.harness.lifecycle.dispose());
  async function run(
    args: string[],
    ctx: PluginCliContext = { threadId: "thr_worker" },
  ) {
    return current.harness.behavior.runCli(args, ctx);
  }
  return {
    setup,
    worker,
    tasks,
    get store() {
      return store;
    },
    get harness() {
      return current.harness;
    },
    run,
    async add(
      options: string[] = [],
      requestId = randomUUID(),
      what = "Prepare evidence",
    ) {
      const args = [
        "commitment",
        "add",
        setup.botId,
        "--what",
        what,
        "--author",
        "fixture-user",
        "--reason",
        "Explicit obligation",
        "--request-id",
        requestId,
        ...options,
        "--json",
      ];
      const result = await run(args);
      return {
        result,
        args,
        id: `cmt_${requestId}`,
        data: result.exitCode === 0 ? JSON.parse(result.stdout) : null,
      };
    },
    async show(id: string) {
      const result = await run([
        "commitment",
        "show",
        setup.botId,
        id,
        "--json",
      ]);
      assert.equal(result.exitCode, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
    async close(id: string, revision: number) {
      return run([
        "commitment",
        "close",
        setup.botId,
        id,
        "--revision",
        String(revision),
        "--author",
        "fixture-user",
        "--reason",
        "Completed obligation",
        "--json",
      ]);
    },
    pauseTaskRead() {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      beforeTaskReply = async () => {
        entered();
        await waiting;
      };
      return { started, release };
    },
    offline() {
      offline = true;
    },
    online() {
      offline = false;
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
      store = openSetup(current.bb.storage);
    },
  };
}
