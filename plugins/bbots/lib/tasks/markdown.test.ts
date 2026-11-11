import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import plugin from "../../server.ts";
import entry from "../../host.ts";
import { openSetup } from "../setup/storage.ts";
import { taskFilesContract } from "./contracts.ts";

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), "bbots-markdown-source-"));
  const host = experimental_createHostEntryHarness(entry);
  let installed = false;
  let inventoryError = false;
  let offline = false;
  let lost = false;
  const calls: { hostId: string; method: string }[] = [];
  let current = createFakePluginHost({
    pluginId: "bbots",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      assert.equal(
        call.hostId,
        "host_original",
        "even a remote caller routes to the original home host",
      );
      calls.push({ hostId: call.hostId, method: call.method });
      if (offline) throw new Error("Original home host is offline");
      const method = call.method as keyof typeof taskFilesContract;
      const input = taskFilesContract[method].input.parse(call.input);
      const output = await host.experimental_call(method, input, {
        signal: call.signal,
      });
      if (lost && method === "tasksInitialize")
        throw new Error("Lost host receipt after file creation");
      return output;
    },
    sdk: {
      plugins: {
        list: async () => {
          if (inventoryError) throw new Error("Inventory unavailable");
          return {
            plugins: installed ? [{ id: "tasks", enabled: false }] : [],
          } as Awaited<ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>>;
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
  current.bb.storage
    .database()
    .prepare("INSERT INTO conversations VALUES (?, ?, 'worker', ?, ?)")
    .run(
      "conv_remote",
      setup.botId,
      "thr_remote_worker",
      new Date().toISOString(),
    );
  t.after(async () => {
    await current.harness.lifecycle.dispose();
    await host.experimental_dispose();
    await rm(base, { recursive: true, force: true });
  });
  return {
    setup,
    calls,
    home: home.path,
    get store() {
      return store;
    },
    get harness() {
      return current.harness;
    },
    async init() {
      return current.harness.behavior.runCli(
        [
          "tasks",
          "markdown-init",
          setup.botId,
          "--revision",
          "0",
          "--author",
          "fixture-user",
          "--reason",
          "Initial Tasks is absent",
          "--json",
        ],
        { threadId: "thr_remote_worker" },
      );
    },
    async show() {
      const result = await current.harness.behavior.runCli([
        "tasks",
        "show",
        setup.botId,
        "--json",
      ]);
      assert.equal(result.exitCode, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
    async read() {
      const result = await current.harness.behavior.runCli(
        ["tasks", "read", setup.botId, "--json"],
        { threadId: "thr_remote_worker" },
      );
      assert.equal(result.exitCode, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
    async write(hash: string, markdown: string) {
      return current.harness.behavior.runCli(
        [
          "tasks",
          "write",
          setup.botId,
          "--hash",
          hash,
          "--markdown",
          markdown,
          "--json",
        ],
        { threadId: "thr_remote_worker" },
      );
    },
    async resume() {
      return current.harness.behavior.runCli([
        "tasks",
        "markdown-resume",
        setup.botId,
        "--revision",
        "1",
        "--author",
        "fixture-user",
        "--reason",
        "Confirm same initialization",
        "--json",
      ]);
    },
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
      store = openSetup(current.bb.storage);
    },
    installTasks() {
      installed = true;
    },
    failInventory() {
      inventoryError = true;
    },
    offline() {
      offline = true;
    },
    online() {
      offline = false;
    },
    lose() {
      lost = true;
    },
    receiptRestored() {
      lost = false;
    },
  };
}

test("confirmed initial absence establishes Markdown authority, with remote workers reading/writing only through the home host", async (t) => {
  const f = await fixture(t);
  const initialized = await f.init();
  assert.equal(initialized.exitCode, 0, initialized.stderr);
  const state = await f.show();
  assert.equal(state.source.kind, "markdown");
  assert.equal(state.source.hostId, "host_original");
  assert.equal(state.availability, "available");
  assert.equal(state.file.path, join(f.home, "tasks.md"));
  assert.equal(
    state.markdown,
    undefined,
    "brief/show do not inject arbitrary Markdown",
  );
  const before = await f.read();
  const markdown = "# Custom tasks\n- [ ] Evidence and decision\n";
  const edited = await f.write(before.hash, markdown);
  assert.equal(edited.exitCode, 0, edited.stderr);
  assert.equal((await f.read()).markdown, markdown);
  assert.equal(await readFile(join(f.home, "tasks.md"), "utf8"), markdown);
  const stale = await f.write(before.hash, "Stale text");
  assert.equal(stale.exitCode, 1);
  assert.equal((await f.read()).markdown, markdown);
  assert.ok(f.calls.every((call) => call.hostId === "host_original"));
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("installed-but-disabled Tasks and unknown inventory refuse Markdown before any file or source write", async (t) => {
  const f = await fixture(t);
  f.installTasks();
  const refused = await f.init();
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /installed.*disabled/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
  f.failInventory();
  assert.equal((await f.init()).exitCode, 1);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json"), null);
  await assert.rejects(readFile(join(f.home, "tasks.md")), { code: "ENOENT" });
});

test("unknown initialization receipt retains its nonce across reload and explicit resume verifies the same file", async (t) => {
  const f = await fixture(t);
  f.lose();
  const result = await f.init();
  assert.equal(result.exitCode, 1);
  const initial = await readFile(join(f.home, "tasks.md"), "utf8");
  const intent = f.store.documents.get(f.setup.botId, "TASKS.json")!;
  assert.equal(JSON.parse(intent.markdown).phase, "initializing");
  await f.reload();
  assert.equal((await f.show()).availability, "recovery-required");
  f.receiptRestored();
  f.installTasks();
  const resumed = await f.resume();
  assert.equal(resumed.exitCode, 0, resumed.stderr);
  assert.equal((await f.show()).revision, 2);
  assert.equal((await f.read()).markdown, initial);
  assert.equal(
    (await f.show()).source.requestId,
    JSON.parse(intent.markdown).requestId,
  );
});

test("later Tasks installation and home-host outages preserve the Markdown authority, with no assumed local path", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.init()).exitCode, 0);
  const before = f.store.documents.get(f.setup.botId, "TASKS.json");
  f.installTasks();
  f.offline();
  const offline = await f.show();
  assert.equal(offline.availability, "unavailable");
  assert.equal(offline.source.kind, "markdown");
  assert.deepEqual(f.store.documents.get(f.setup.botId, "TASKS.json"), before);
  f.online();
  assert.equal((await f.show()).availability, "available");
  const brief = await f.harness.behavior.runCli([
    "brief",
    f.setup.botId,
    "--json",
  ]);
  assert.equal(JSON.parse(brief.stdout).taskSource.source.kind, "markdown");
  assert.equal(JSON.parse(brief.stdout).taskSource.file.markdown, undefined);
  await rm(join(f.home, "tasks.md"));
  assert.equal((await f.show()).availability, "unavailable");
  assert.equal((await f.init()).exitCode, 1);
  await assert.rejects(readFile(join(f.home, "tasks.md")), { code: "ENOENT" });
});

test("a ready Tasks authority cannot become Markdown during an outage", async (t) => {
  const f = await fixture(t);
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 0,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "ready",
      boardId: "tracker_original",
    }),
    author: "fixture-user",
    reason: "Existing source",
  });
  const result = await f.harness.behavior.runCli([
    "tasks",
    "markdown-init",
    f.setup.botId,
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Outage fallback",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /never switch.*outage/);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(
    JSON.parse(f.store.documents.get(f.setup.botId, "TASKS.json")!.markdown)
      .boardId,
    "tracker_original",
  );
});
