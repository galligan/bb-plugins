import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";

function fixture(t: TestContext) {
  let unavailable = false;
  let loseReceipt = false;
  let creates = 0;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const receipt = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = false;
  const boards = new Map([
    [
      "tracker_existing",
      { id: "tracker_existing", name: "Existing", prefix: "EXIST" },
    ],
  ]);
  let store: ReturnType<typeof openSetup>;
  let current: ReturnType<typeof createFakePluginHost>;
  const host = createFakePluginHost({
    pluginId: "bbots",
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method, input, outputSchema, signal }) => {
          assert.equal(pluginId, "tasks");
          assert.ok(signal, "every call has a bounded cancellation signal");
          if (unavailable)
            throw new Error("Tasks is absent, disabled or offline");
          if (method === "listProjects") {
            assert.deepEqual(input, {});
            return outputSchema.parse({ projects: [...boards.values()] });
          }
          assert.equal(method, "createProject");
          const request = input as {
            name: string;
            prefix: string;
            linkedBbProjectId: null;
          };
          assert.equal(request.linkedBbProjectId, null);
          const intent = store.documents.get(setup.botId, "TASKS.json")!;
          assert.equal(JSON.parse(intent.markdown).phase, "creating");
          assert.equal(intent.author, "fixture-user");
          assert.equal(intent.revision, 1);
          creates++;
          const board = {
            id: "tracker_created",
            name: request.name,
            prefix: request.prefix,
          };
          boards.set(board.id, board);
          enter();
          if (hold) await receipt;
          if (loseReceipt)
            throw new Error("Lost receipt after native creation");
          return outputSchema.parse({ project: board });
        },
      },
    },
  });
  current = host;
  t.after(() => current.harness.lifecycle.dispose());
  plugin(host.bb);
  store = openSetup(host.bb.storage);
  const setup = store.plan({
    requestId: randomUUID(),
    hostId: "host_home",
    name: "Bob",
    associations: { mode: "none" },
  });
  const change = [
    "--revision",
    "0",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit source choice",
    "--json",
  ];
  return {
    store,
    setup,
    boards,
    get harness() {
      return current.harness;
    },
    get creates() {
      return creates;
    },
    async run(command: string[], ctx = {}) {
      return current.harness.behavior.runCli(
        [...command, setup.botId, ...change],
        ctx,
      );
    },
    async show() {
      const result = await current.harness.behavior.runCli([
        "tasks",
        "show",
        setup.botId,
        "--json",
      ]);
      assert.equal(result.exitCode, 0);
      return JSON.parse(result.stdout);
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
    },
    offline() {
      unavailable = true;
    },
    online() {
      unavailable = false;
    },
    lose() {
      loseReceipt = true;
    },
    holdReceipt() {
      hold = true;
      return { entered, release };
    },
  };
}

test("task authority is initially unconfigured and selecting a stable board neither binds a project nor starts work", async (t) => {
  const f = fixture(t);
  assert.equal((await f.show()).availability, "unconfigured");
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  const selected = await f.run([
    "tasks",
    "select",
    "--board",
    "tracker_existing",
  ]);
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout).source, {
    kind: "tasks",
    phase: "ready",
    boardId: "tracker_existing",
  });
  f.boards.set("tracker_existing", {
    id: "tracker_existing",
    name: "Renamed",
    prefix: "NEW",
  });
  await f.reload();
  const current = await f.show();
  assert.equal(current.board.name, "Renamed");
  assert.equal(current.source.boardId, "tracker_existing");
  assert.equal(f.creates, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("projects.create").length, 0);
});

test("outage or removal preserves the configured task authority without Markdown fallback or replacement", async (t) => {
  const f = fixture(t);
  assert.equal(
    (await f.run(["tasks", "select", "--board", "tracker_existing"])).exitCode,
    0,
  );
  const before = f.store.documents.get(f.setup.botId, "TASKS.json");
  f.offline();
  assert.equal((await f.show()).availability, "unavailable");
  assert.deepEqual(f.store.documents.get(f.setup.botId, "TASKS.json"), before);
  f.online();
  f.boards.delete("tracker_existing");
  assert.equal((await f.show()).availability, "unavailable");
  assert.deepEqual(f.store.documents.get(f.setup.botId, "TASKS.json"), before);
  assert.equal(f.creates, 0);
  assert.equal(f.harness.inspection.registrations.services.length, 0);
});

test("explicit board creation journals intent before RPC and records the stable returned ID with audit revisions", async (t) => {
  const f = fixture(t);
  const result = await f.run(["tasks", "create", "--prefix", "BOB"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(f.creates, 1);
  const current = await f.show();
  assert.equal(current.revision, 2);
  assert.equal(current.source.boardId, "tracker_created");
  assert.equal(current.board.name, "Bots: Bob");
  const first = f.store.documents.revision(f.setup.botId, "TASKS.json", 1);
  assert.equal(JSON.parse(first.markdown).phase, "creating");
  const replay = await f.run(["tasks", "create", "--prefix", "BOB"]);
  assert.equal(replay.exitCode, 1);
  assert.equal(f.creates, 1);
});

test("lost board receipt survives reload and only explicit matching-ID recovery may complete it", async (t) => {
  const f = fixture(t);
  f.lose();
  const result = await f.run(["tasks", "create", "--prefix", "BOB"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /uncertain.*intent revision 1.*did not retry/i);
  await f.reload();
  const pending = await f.show();
  assert.equal(pending.availability, "recovery-required");
  assert.equal(pending.source.prefix, "BOB");
  const repeat = await f.harness.behavior.runCli([
    "tasks",
    "create",
    f.setup.botId,
    "--prefix",
    "BOB",
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Repeat",
  ]);
  assert.equal(repeat.exitCode, 1);
  assert.equal(f.creates, 1);
  for (const boardId of ["tracker_existing", "tracker_missing"]) {
    const refused = await f.harness.behavior.runCli([
      "tasks",
      "recover",
      f.setup.botId,
      "--board",
      boardId,
      "--revision",
      "1",
      "--author",
      "fixture-user",
      "--reason",
      "Confirm original board",
    ]);
    assert.equal(refused.exitCode, 1);
    assert.equal((await f.show()).revision, 1);
  }
  const recovered = await f.harness.behavior.runCli([
    "tasks",
    "recover",
    f.setup.botId,
    "--board",
    "tracker_created",
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Confirmed original board",
    "--json",
  ]);
  assert.equal(recovered.exitCode, 0, recovered.stderr);
  assert.equal((await f.show()).source.boardId, "tracker_created");
  assert.equal((await f.show()).revision, 2);
  assert.equal(f.creates, 1);
});

test("a canceled caller cannot finalize a late board receipt or trigger another creation", async (t) => {
  const f = fixture(t);
  const gate = f.holdReceipt();
  const controller = new AbortController();
  const pending = f.run(["tasks", "create", "--prefix", "BOB"], {
    signal: controller.signal,
  });
  await gate.entered;
  controller.abort(new Error("User stopped waiting"));
  gate.release();
  const result = await pending;
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /uncertain/);
  assert.equal((await f.show()).availability, "recovery-required");
  assert.equal((await f.show()).revision, 1);
  assert.equal(f.creates, 1);
});

test("absent Tasks, missing selections and occupied prefixes fail before authority or creation is recorded", async (t) => {
  const f = fixture(t);
  f.offline();
  assert.equal(
    (await f.run(["tasks", "create", "--prefix", "BOB"])).exitCode,
    1,
  );
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
  f.online();
  assert.equal(
    (await f.run(["tasks", "select", "--board", "tracker_missing"])).exitCode,
    1,
  );
  assert.equal(
    (await f.run(["tasks", "create", "--prefix", "EXIST"])).exitCode,
    1,
  );
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
  assert.equal(f.creates, 0);
});

test("concurrent create requests use the revision guard to make at most one external board request", async (t) => {
  const f = fixture(t);
  const outcomes = await Promise.all([
    f.run(["tasks", "create", "--prefix", "BOB"]),
    f.run(["tasks", "create", "--prefix", "OTHER"]),
  ]);
  assert.deepEqual(outcomes.map((value) => value.exitCode).sort(), [0, 1]);
  assert.equal(f.creates, 1);
  assert.equal((await f.show()).revision, 2);
});

test("a ready source cannot be replaced by selection, creation or recovery", async (t) => {
  const f = fixture(t);
  assert.equal(
    (await f.run(["tasks", "select", "--board", "tracker_existing"])).exitCode,
    0,
  );
  const before = f.store.documents.get(f.setup.botId, "TASKS.json");
  for (const command of [
    ["select", "--board", "tracker_other"],
    ["create", "--prefix", "BOB"],
    ["recover", "--board", "tracker_existing"],
  ]) {
    const outcome = await f.harness.behavior.runCli([
      "tasks",
      command[0]!,
      f.setup.botId,
      ...command.slice(1),
      "--revision",
      "1",
      "--author",
      "fixture-user",
      "--reason",
      "Another source",
    ]);
    assert.equal(outcome.exitCode, 1);
  }
  assert.deepEqual(f.store.documents.get(f.setup.botId, "TASKS.json"), before);
  assert.equal(f.creates, 0);
});

test("an owned caller cannot select another bot's task source", async (t) => {
  const f = fixture(t);
  const other = f.store.profiles.create({
    name: "Alice",
    author: "fixture-user",
    reason: "Second bot",
  });
  f.store.conversations.bindInitialThread(
    other.mainConversationId,
    "thr_alice",
  );
  const refused = await f.run(
    ["tasks", "select", "--board", "tracker_existing"],
    { threadId: "thr_alice" },
  );
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /another bot/);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
});
