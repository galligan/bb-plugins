// The real server factory under the public SDK fake host. Rex is a FakeRex
// behind a control socket in a temporary directory, found through a `rex`
// command placed first on PATH, so no real Rex server is ever contacted.
//
// Not covered here: a successful `/stream`. Opening a pane needs Rex's data
// connection, which FakeRex does not speak; the relay and handshake have their
// own tests against real sockets.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";

import plugin from "../server.ts";
import { FakeRex } from "./fake-rex.ts";
import { serveFakeRex } from "./fake-rex-socket.ts";
import { paneErrorBodySchema } from "./pane-error.ts";
import { targetsSchema } from "./targets.ts";
import { THREAD_VIEW_KEY_PREFIX } from "./thread-view.ts";
import { THREAD_WINDOW_KEY_PREFIX } from "./thread-window.ts";

const THREAD = "thr_one";
const threads = {
  [THREAD]: makeThreadResponse({ id: THREAD, title: "Fix the login redirect" }),
  thr_archived: makeThreadResponse({ id: "thr_archived", archivedAt: 1 }),
  thr_deleted: makeThreadResponse({ id: "thr_deleted", deletedAt: 1 }),
};

async function setup(t: TestContext, settings: { sessionLabel?: string } = {}) {
  const rex = new FakeRex();
  const socket = await serveFakeRex(rex);
  const { bb, harness } = createFakePluginHost({
    pluginId: "rex",
    settings,
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const thread = Object.entries(threads).find(
            ([id]) => id === threadId,
          )?.[1];
          if (thread === undefined) throw new Error("not found");
          return thread;
        },
      },
    },
  });
  t.after(async () => {
    await harness.lifecycle.dispose();
    await socket.close();
  });
  await plugin(bb);
  const json = async (method: string, path: string, body?: unknown) => {
    const response = await harness.behavior.fetchHttp(
      method,
      path,
      body === undefined
        ? undefined
        : {
            body: typeof body === "string" ? body : JSON.stringify(body),
            headers: { "content-type": "application/json" },
          },
    );
    const text = await response.text();
    const parsed: unknown = text === "" ? null : JSON.parse(text);
    return { status: response.status, body: parsed };
  };
  const failure = async (method: string, path: string, body?: unknown) => {
    const response = await json(method, path, body);
    return {
      status: response.status,
      code: paneErrorBodySchema.parse(response.body).error.code,
    };
  };
  const target = (thread = THREAD) =>
    harness.behavior.runCli(["target", "--thread", thread, "--json"]);
  return { bb, harness, rex, socket, json, failure, target };
}

test("registers the setting, five routes, the command, the instructions hook, and both thread listeners", async (t) => {
  const { harness } = await setup(t);
  const { registrations } = harness.inspection;
  assert.deepEqual(Object.keys(registrations.settingsDescriptors), [
    "sessionLabel",
  ]);
  assert.deepEqual(
    registrations.httpRoutes.map((route) => `${route.method} ${route.path}`),
    [
      "GET /stream",
      "POST /input",
      "GET /targets",
      "POST /target",
      "GET /ghostty-vt.wasm",
    ],
  );
  assert.equal(registrations.cli?.name, "rex");
  assert.deepEqual(
    registrations.cli?.commands.map((command) => command.name),
    ["target"],
  );
  assert.equal(typeof registrations.instructionProvider, "function");
  assert.equal(registrations.threadEventHandlers["thread.archived"], 1);
  assert.equal(registrations.threadEventHandlers["thread.deleted"], 1);
  assert.deepEqual(registrations.rpcMethods, []);
  assert.deepEqual(registrations.services, []);
});

test("serves the vendored decoder as WebAssembly", async (t) => {
  const { harness } = await setup(t);
  const response = await harness.behavior.fetchHttp("GET", "/ghostty-vt.wasm");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
});

test("the command makes the thread's own window once and reports the same one again", async (t) => {
  const { rex, target } = await setup(t);
  const first = await target();
  assert.equal(first.exitCode, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(report.thread, THREAD);
  assert.equal(report.session.label, "bb");
  assert.equal(report.window.own, true);
  assert.match(report.window.label, /Fix the login redirect/);
  assert.equal(rex.sessions.length, 1);
  assert.equal(rex.sessions[0]!.windows.length, 1);

  const second = await target();
  assert.deepEqual(JSON.parse(second.stdout), report);
  assert.equal(rex.sessions[0]!.windows.length, 1);
});

test("the command refuses a missing, archived, or deleted thread without touching Rex", async (t) => {
  const { rex, target } = await setup(t);
  for (const thread of ["thr_unknown", "thr_archived", "thr_deleted"]) {
    const result = await target(thread);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /bad_thread|could not find|archived/);
  }
  assert.deepEqual(rex.sessions, []);
});

test("the session label setting chooses the session, and an empty label is refused", async (t) => {
  const named = await setup(t, { sessionLabel: "work" });
  assert.equal((await named.target()).exitCode, 0);
  assert.deepEqual(
    named.rex.sessions.map((session) => session.label),
    ["work"],
  );

  const empty = await setup(t, { sessionLabel: "   " });
  const result = await empty.target();
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /session label setting is empty/);
  assert.deepEqual(empty.rex.sessions, []);
});

test("only a thread with a Rex window is given instructions, and they survive a reload", async (t) => {
  const { harness, target } = await setup(t);
  const instructions = () =>
    harness.inspection.registrations.instructionProvider?.({
      threadId: THREAD,
      projectId: "proj_one",
    });
  assert.equal(instructions(), null);
  await target();
  assert.match(instructions() ?? "", /rex-thread-terminal/);
  assert.equal(
    harness.inspection.registrations.instructionProvider?.({
      threadId: "thr_other",
      projectId: "proj_one",
    }),
    null,
  );
  // The index is rebuilt from storage, not carried in memory.
  await harness.lifecycle.reload(plugin);
  assert.match(instructions() ?? "", /rex-thread-terminal/);
});

test("the stream route refuses a missing or unusable thread before any pane is opened", async (t) => {
  const { failure, rex } = await setup(t);
  assert.deepEqual(await failure("GET", "/stream"), {
    status: 409,
    code: "bad_thread",
  });
  for (const thread of ["thr_unknown", "thr_archived"]) {
    const result = await failure("GET", `/stream?thread=${thread}`);
    assert.equal(result.code, "bad_thread");
  }
  assert.deepEqual(rex.sessions, []);
});

test("the input route rejects a malformed batch and a stream that is not open", async (t) => {
  const { failure } = await setup(t);
  assert.deepEqual(await failure("POST", "/input", "not json"), {
    status: 400,
    code: "bad_input",
  });
  assert.deepEqual(await failure("POST", "/input", { pane: 1 }), {
    status: 400,
    code: "bad_input",
  });
  assert.deepEqual(
    await failure("POST", "/input", {
      pane: "pane_gone",
      events: [{ type: "focus", focused: true }],
    }),
    { status: 410, code: "pane_closed" },
  );
});

test("targets lists Rex's windows with the thread's own window and its pick", async (t) => {
  const { bb, json, failure, rex, target } = await setup(t);
  const other = rex.addSession("scratch", ["logs"]);
  const before = await json("GET", `/targets?thread=${THREAD}`);
  assert.equal(before.status, 200);
  const initial = targetsSchema.parse(before.body);
  assert.equal(initial.own, null);
  assert.equal(initial.pick, null);

  const report = JSON.parse((await target()).stdout);
  const pick = {
    sessionId: other.id,
    windowId: other.windows[0]!.id,
    blockId: null,
  };
  const picked = await json("POST", "/target", {
    thread: THREAD,
    target: pick,
  });
  assert.equal(picked.status, 204, JSON.stringify(picked.body));
  const after = await json("GET", `/targets?thread=${THREAD}`);
  const targets = targetsSchema.parse(after.body);
  assert.deepEqual(targets.own, {
    sessionId: report.session.id,
    windowId: report.window.id,
  });
  assert.deepEqual(targets.pick, pick);
  assert.deepEqual(targets.sessions.map((session) => session.label).sort(), [
    "bb",
    "scratch",
  ]);

  // Going back to the thread's own window clears the pick.
  assert.equal(
    (await json("POST", "/target", { thread: THREAD, target: null })).status,
    204,
  );
  assert.equal(
    await bb.storage.kv.get(THREAD_VIEW_KEY_PREFIX + THREAD),
    undefined,
  );
  assert.equal(
    (await failure("GET", "/targets?thread=thr_unknown")).code,
    "bad_thread",
  );
});

test("a pick must be well formed and name a window that still exists", async (t) => {
  const { bb, failure, rex } = await setup(t);
  const session = rex.addSession("scratch", ["logs"]);
  assert.deepEqual(await failure("POST", "/target", { thread: THREAD }), {
    status: 400,
    code: "bad_input",
  });
  assert.deepEqual(
    await failure("POST", "/target", {
      thread: THREAD,
      target: { sessionId: session.id, windowId: "window:gone", blockId: null },
    }),
    { status: 409, code: "no_terminal" },
  );
  assert.equal(
    await bb.storage.kv.get(THREAD_VIEW_KEY_PREFIX + THREAD),
    undefined,
  );
});

test("archiving or deleting a thread closes its own window and forgets it; other threads are left alone", async (t) => {
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    const { bb, harness, rex, target } = await setup(t);
    await target();
    const session = rex.sessions[0]!;
    rex.openWindow(session, "someone else's");
    assert.equal(session.windows.length, 2);

    const calls = rex.calls.length;
    const untouched = await harness.behavior.emitThreadEvent(event, {
      thread: makeThreadResponse({ id: "thr_never_used_rex" }),
    });
    assert.deepEqual(untouched.errors, []);
    assert.equal(rex.calls.length, calls, "Rex is not contacted for it");

    const closed = await harness.behavior.emitThreadEvent(event, {
      thread: threads[THREAD],
    });
    assert.deepEqual(closed.errors, []);
    assert.deepEqual(
      session.windows.map((window) => window.label),
      ["someone else's"],
    );
    assert.equal(
      await bb.storage.kv.get(THREAD_WINDOW_KEY_PREFIX + THREAD),
      undefined,
    );
    assert.equal(
      harness.inspection.registrations.instructionProvider?.({
        threadId: THREAD,
        projectId: "proj_one",
      }),
      null,
    );
  }
});

test("each fixture removes only its own entry from PATH", async () => {
  const before = process.env.PATH;
  const first = await serveFakeRex(new FakeRex());
  const second = await serveFakeRex(new FakeRex());
  // Closed in the order they were opened, as test hooks run.
  await first.close();
  await second.close();
  assert.equal(process.env.PATH, before);
});

test("when Rex cannot be found, routes answer 503 and a close is logged and kept for later", async (t) => {
  const { bb, harness, socket, failure, target } = await setup(t);
  await target();
  socket.stopReporting();
  assert.deepEqual(await failure("GET", `/targets?thread=${THREAD}`), {
    status: 503,
    code: "rex_unreachable",
  });
  const result = await target();
  assert.notEqual(result.exitCode, 0);

  const event = await harness.behavior.emitThreadEvent("thread.archived", {
    thread: threads[THREAD],
  });
  assert.deepEqual(event.errors, []);
  // The record stays so the next load can try again.
  assert.notEqual(
    await bb.storage.kv.get(THREAD_WINDOW_KEY_PREFIX + THREAD),
    undefined,
  );
  assert.ok(
    harness.inspection.logEntries.some(
      (entry) =>
        entry.level === "warn" &&
        entry.message.includes(`could not close the Rex window of ${THREAD}`),
    ),
  );
});

test("a thread archived while the plugin was unloaded has its window closed on the next load", async (t) => {
  const { bb, harness, rex, target } = await setup(t);
  // Record a window for a thread that bb now reports as archived.
  await target();
  const record = await bb.storage.kv.get(THREAD_WINDOW_KEY_PREFIX + THREAD);
  await bb.storage.kv.set(THREAD_WINDOW_KEY_PREFIX + "thr_archived", record);
  await bb.storage.kv.delete(THREAD_WINDOW_KEY_PREFIX + THREAD);
  assert.equal(rex.sessions[0]!.windows.length, 1);

  // The reload hands the factory a fresh API; the old handle is stale after it.
  let reloaded = bb;
  await harness.lifecycle.reload(async (next) => {
    reloaded = next;
    await plugin(next);
  });
  // The plugin forgets the record only after Rex answers the close, so the
  // window can be gone from Rex while the record is still there. Wait for the
  // record, which is the last step.
  const key = THREAD_WINDOW_KEY_PREFIX + "thr_archived";
  const deadline = Date.now() + 5_000;
  while (
    (await reloaded.storage.kv.get(key)) !== undefined &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await reloaded.storage.kv.get(key), undefined);
  assert.equal(rex.sessions[0]!.windows.length, 0);
});
