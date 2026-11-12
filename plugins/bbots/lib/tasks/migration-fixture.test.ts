import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createHash } from "node:crypto";
import type { PluginCliContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import plugin from "../../server.ts";
import entry from "../../host.ts";
import { openSetup } from "../setup/storage.ts";
import { taskFilesContract } from "./contracts.ts";

export async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), "bbots-assisted-migration-"));
  const host = experimental_createHostEntryHarness(entry);
  let offline = false;
  let afterDestinationRead = () => {};
  let current = createFakePluginHost({
    pluginId: "bbots",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      assert.equal(call.hostId, "host_original");
      assert.equal(
        call.method,
        "tasksRead",
        "migration never writes or initializes a destination file",
      );
      const file = await host.experimental_call(
        "tasksRead",
        taskFilesContract.tasksRead.input.parse(call.input),
      );
      afterDestinationRead();
      return file;
    },
    sdk: {
      plugins: {
        callRpc: async ({ method, input, outputSchema }) => {
          if (offline) throw new Error("Destination unavailable");
          if (method === "getTask") {
            const taskId = (input as { taskId: string }).taskId;
            return outputSchema.parse({
              task: {
                id: taskId,
                projectId: taskId === "task_old" ? "board_old" : "board_new",
                key: taskId === "task_old" ? "OLD-1" : "NEW-1",
                title: "Mapped obligation",
                status: "todo",
              },
            });
          }
          assert.equal(
            method,
            "listProjects",
            "migration never creates, edits or deletes a board/task",
          );
          afterDestinationRead();
          return outputSchema.parse({
            projects: [
              { id: "board_old", name: "Original", prefix: "OLD" },
              { id: "board_new", name: "Prepared", prefix: "NEW" },
            ],
          });
        },
      },
    },
  });
  plugin(current.bb);
  let store = openSetup(current.bb.storage);
  const setup = store.plan({
    requestId: randomUUID(),
    hostId: "host_original",
    name: "Bob",
    associations: { mode: "none" },
  });
  const home = await host.experimental_call("prepare", {
    botId: setup.botId,
    base,
  });
  store.setHome(setup.botId, home.path);
  store.conversations.bindInitialThread(setup.conversationId, "thr_main");
  function source(boardId = "board_old", expectedRevision = 0) {
    store.documents.write({
      botId: setup.botId,
      name: "TASKS.json",
      expectedRevision,
      markdown: JSON.stringify({ kind: "tasks", phase: "ready", boardId }),
      author: "fixture-user",
      reason: "Source fixture",
    });
  }
  source();
  t.after(async () => {
    await current.harness.lifecycle.dispose();
    await host.experimental_dispose();
    await rm(base, { recursive: true, force: true });
  });
  async function run(
    args: string[],
    ctx: PluginCliContext = { threadId: "thr_main" },
  ) {
    return current.harness.behavior.runCli(args, ctx);
  }
  function args(
    target = ["--board", "board_new"],
    requestId = randomUUID(),
    revision = 1,
  ) {
    return [
      "tasks",
      "migration-confirm",
      setup.botId,
      ...target,
      "--revision",
      String(revision),
      "--request-id",
      requestId,
      "--mapping",
      JSON.stringify([
        { from: "OLD-1 / original snapshot", to: "NEW-1 / inspected copy" },
      ]),
      "--evidence",
      "User confirmed content and mapping inspection",
      "--author",
      "fixture-user",
      "--reason",
      "Explicit user-directed migration",
      "--json",
    ];
  }
  return {
    setup,
    home: home.path,
    run,
    args,
    source,
    get store() {
      return store;
    },
    get db() {
      return current.bb.storage.database();
    },
    get harness() {
      return current.harness;
    },
    offline() {
      offline = true;
    },
    online() {
      offline = false;
    },
    afterRead(fn: () => void) {
      afterDestinationRead = fn;
    },
    async prepare(markdown: string) {
      await writeFile(join(home.path, "tasks.md"), markdown);
      return createHash("sha256").update(markdown).digest("hex");
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
      store = openSetup(current.bb.storage);
    },
  };
}
