import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { createSourceStore } from "./source-store.ts";
import { taskSettingsState } from "./settings-contracts.ts";
import type { Board } from "./client.ts";

function fixture(t: TestContext) {
  const boards: Board[] = [
    { id: "tracker_original", name: "Original board", prefix: "BOT" },
  ];
  let unavailable = false;
  let beforeList = async () => {};
  let current = createFakePluginHost({
    pluginId: "bbots",
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method, outputSchema, signal }) => {
          assert.equal(pluginId, "tasks");
          assert.equal(
            method,
            "listProjects",
            "settings never create a board or update tasks",
          );
          assert.ok(signal, "lookup is bounded and cancellable");
          await beforeList();
          if (unavailable) throw new Error("Tasks offline");
          return outputSchema.parse({ projects: boards });
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
  const journal = createSourceStore(store, () => {});
  t.after(() => current.harness.lifecycle.dispose());
  return {
    boards,
    get store() {
      return store;
    },
    setup,
    journal,
    get harness() {
      return current.harness;
    },
    offline() {
      unavailable = true;
    },
    hold() {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((yes) => {
        enter = yes;
      });
      const gate = new Promise<void>((yes) => {
        release = yes;
      });
      beforeList = async () => {
        enter();
        await gate;
      };
      return { entered, release };
    },
    async read(query = "") {
      return taskSettingsState.parse(
        await current.harness.behavior.callRpc("taskSettings", {
          botId: setup.botId,
          query,
        }),
      );
    },
    async select(
      boardId = "tracker_original",
      expectedRevision = 0,
      signal?: AbortSignal,
    ) {
      return taskSettingsState.parse(
        await current.harness.behavior.callRpc(
          "taskBoardSelect",
          { botId: setup.botId, boardId, expectedRevision },
          { signal },
        ),
      );
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
      store = openSetup(current.bb.storage);
    },
  };
}

test("task settings distinguish empty, filtered, bounded and unavailable catalogs without choosing a source", async (t) => {
  const f = fixture(t);
  assert.equal((await f.read()).catalog.boards[0]?.id, "tracker_original");
  assert.equal((await f.read("bOt")).catalog.boards.length, 1);
  assert.deepEqual((await f.read("missing")).catalog, {
    status: "available",
    boards: [],
    hasMore: false,
  });
  f.boards.length = 0;
  assert.equal((await f.read()).catalog.status, "available");
  for (let i = 0; i < 101; i++)
    f.boards.push({ id: `tracker_${i}`, name: `Board ${i}`, prefix: `B${i}` });
  const page = await f.read();
  assert.equal(page.catalog.boards.length, 100);
  assert.equal(page.catalog.hasMore, true);
  assert.equal(
    (await f.read("Board 100")).catalog.boards[0]?.id,
    "tracker_100",
  );
  f.offline();
  assert.deepEqual((await f.read()).catalog, {
    status: "unavailable",
    boards: [],
    hasMore: false,
  });
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
  assert.ok(
    f.harness.inspection.sdk.calls.every(
      (call) => call.path === "plugins.callRpc",
    ),
  );
});

test("the real settings RPC selects a stable board once with CAS and survives reload/rename without native work", async (t) => {
  const f = fixture(t);
  const state = await f.select();
  assert.equal(state.revision, 1);
  assert.equal(state.board?.id, "tracker_original");
  assert.equal(state.catalog.status, "not-applicable");
  const doc = f.store.documents.get(f.setup.botId, "TASKS.json")!;
  assert.equal(doc.author, "user:bot-settings");
  await assert.rejects(f.select(), /changed/);
  await assert.rejects(f.select("tracker_original", 1), /already recorded/);
  f.boards[0] = { id: "tracker_original", name: "Renamed", prefix: "NEW" };
  await f.reload();
  assert.equal((await f.read()).board?.name, "Renamed");
  f.offline();
  const missing = await f.read();
  assert.equal(missing.availability, "unavailable");
  assert.deepEqual(missing.board, {
    id: "tracker_original",
    name: null,
    prefix: null,
  });
  assert.deepEqual(f.store.documents.get(f.setup.botId, "TASKS.json"), doc);
  assert.ok(
    f.harness.inspection.sdk.calls.every(
      (call) => call.path === "plugins.callRpc",
    ),
  );
});

test("a ready file or interrupted creation stays authoritative and cannot be replaced from Settings", async (t) => {
  const f = fixture(t);
  f.journal.write(
    {
      botId: f.setup.botId,
      expectedRevision: 0,
      author: "fixture",
      reason: "Interrupted creation",
    },
    { kind: "tasks", phase: "creating", name: "Bob", prefix: "BOB" },
  );
  assert.equal((await f.read()).availability, "recovery-required");
  await assert.rejects(f.select("tracker_original", 1), /already recorded/);
  const other = f.store.plan({
    requestId: randomUUID(),
    hostId: "host_original",
    name: "Alice",
    associations: { mode: "none" },
  });
  f.journal.write(
    {
      botId: other.botId,
      expectedRevision: 0,
      author: "fixture",
      reason: "Existing file",
    },
    {
      kind: "markdown",
      phase: "ready",
      hostId: "host_original",
      homePath: "/original/home",
      requestId: randomUUID(),
      path: "/original/home/tasks.md",
    },
  );
  const source = taskSettingsState.parse(
    await f.harness.behavior.callRpc("taskSettings", { botId: other.botId }),
  );
  assert.equal(source.kind, "markdown");
  assert.equal(source.catalog.status, "not-applicable");
  assert.deepEqual(source.file, {
    hostId: "host_original",
    path: "/original/home/tasks.md",
  });
  await assert.rejects(
    f.harness.behavior.callRpc("taskBoardSelect", {
      botId: other.botId,
      boardId: "tracker_original",
      expectedRevision: 1,
    }),
    /already recorded/,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("a catalog returning after another source change reports current authority without allowing a second choice", async (t) => {
  const f = fixture(t),
    gate = f.hold();
  const pending = f.read();
  await gate.entered;
  f.journal.write(
    {
      botId: f.setup.botId,
      expectedRevision: 0,
      author: "other-user",
      reason: "Concurrent choice",
    },
    { kind: "tasks", phase: "ready", boardId: "tracker_other" },
  );
  gate.release();
  const state = await pending;
  assert.equal(state.availability, "changed-during-read");
  assert.equal(state.board?.id, "tracker_other");
  assert.equal(state.board?.name, null);
  assert.equal(state.catalog.status, "not-applicable");
  await assert.rejects(f.select(), /changed/);
});

test("canceling a held selection cannot record its late board result", async (t) => {
  const f = fixture(t),
    gate = f.hold(),
    controller = new AbortController();
  const pending = f.select("tracker_original", 0, controller.signal);
  await gate.entered;
  controller.abort(new Error("Canceled caller"));
  gate.release();
  await assert.rejects(pending, /Canceled/);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
});

test("a second writer winning during validation makes the settings CAS refuse rather than overwrite", async (t) => {
  const f = fixture(t),
    gate = f.hold();
  const pending = f.select();
  await gate.entered;
  f.journal.write(
    {
      botId: f.setup.botId,
      expectedRevision: 0,
      author: "other-user",
      reason: "Concurrent choice",
    },
    { kind: "tasks", phase: "ready", boardId: "tracker_other" },
  );
  gate.release();
  await assert.rejects(pending, /revision|changed/i);
  assert.equal(f.journal.read(f.setup.botId).source?.kind, "tasks");
  assert.equal(f.journal.read(f.setup.botId).revision, 1);
  assert.equal(
    f.store.documents.get(f.setup.botId, "TASKS.json")?.author,
    "other-user",
  );
});
