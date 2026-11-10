// A thread set to show another window than its own, or a particular pane.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FakeRex } from "./fake-rex.ts";
import { PaneError } from "./pane-error.ts";
import type { ThreadView } from "./thread-view.ts";
import {
  closeThreadWindow,
  ensureThreadWindow,
  type ThreadWindowRecord,
} from "./thread-window.ts";

const THREAD = { id: "thr_one", title: "Fix the login redirect", cwd: null };
const OWN_LABEL = "Fix the login redirect [thr_one]";

/** The plugin's storage, in memory. */
function storage() {
  const records = new Map<string, ThreadWindowRecord>();
  const picks = new Map<string, ThreadView>();
  return {
    records,
    picks,
    windows: {
      get: (threadId: string) => Promise.resolve(records.get(threadId)),
      set: (threadId: string, record: ThreadWindowRecord) => {
        records.set(threadId, record);
        return Promise.resolve();
      },
      delete: (threadId: string) => {
        records.delete(threadId);
        return Promise.resolve();
      },
    },
    views: {
      get: (threadId: string) => Promise.resolve(picks.get(threadId)),
      set: (threadId: string, view: ThreadView) => {
        picks.set(threadId, view);
        return Promise.resolve();
      },
      delete: (threadId: string) => {
        picks.delete(threadId);
        return Promise.resolve();
      },
    },
  };
}

const ensure = (rex: FakeRex, store: ReturnType<typeof storage>) =>
  ensureThreadWindow(rex, {
    sessionLabel: "bb",
    loadThread: () => Promise.resolve(THREAD),
    windows: store.windows,
    views: store.views,
  });

/** A Rex with the user's own session, and the thread's window already made. */
async function setup() {
  const rex = new FakeRex();
  const main = rex.addSession("main", ["editor", "server"]);
  const store = storage();
  const own = await ensure(rex, store);
  const [editor, server] = main.windows;
  assert.ok(editor !== undefined && server !== undefined);
  rex.calls.length = 0;
  return { rex, store, own, main, editor, server };
}

test("shows the window picked for the thread, and changes nothing about it", async () => {
  const { rex, store, own, main, server } = await setup();
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: null,
  });

  const shown = await ensure(rex, store);
  assert.deepEqual(shown, {
    sessionId: main.id,
    windowId: server.id,
    blockId: server.blocks[0]?.id,
    sessionLabel: "main",
    windowLabel: "server",
    own: false,
    clientId: "client:test",
  });
  // Looked at, not relabelled, and no window made beside it.
  assert.deepEqual(rex.methods, ["session.list", "session.attach"]);
  assert.equal(server.label, "server");
  assert.equal(main.windows.length, 2);
  // The thread's own window stays where it was.
  assert.equal(store.records.get("thr_one")?.windowId, own.windowId);
});

test("shows the pane picked in that window, or its focused pane", async () => {
  const { rex, store, main, server } = await setup();
  const logs = rex.split(server, "logs");
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: logs.id,
  });
  assert.equal((await ensure(rex, store)).blockId, logs.id);

  server.blocks.splice(server.blocks.indexOf(logs), 1);
  assert.equal((await ensure(rex, store)).blockId, server.blocks[0]?.id);
});

test("goes back to the thread's own window when the picked one is gone", async () => {
  const { rex, store, own, main, server } = await setup();
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: null,
  });
  main.windows.splice(main.windows.indexOf(server), 1);

  const shown = await ensure(rex, store);
  assert.equal(shown.windowId, own.windowId);
  assert.equal(shown.own, true);
  assert.equal(store.picks.has("thr_one"), false, "the pick is forgotten");
});

test("goes back to its own window when the picked session is gone", async () => {
  const { rex, store, own, main, server } = await setup();
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: null,
  });
  rex.sessions.splice(rex.sessions.indexOf(main), 1);

  const shown = await ensure(rex, store);
  assert.equal(shown.windowId, own.windowId);
  assert.equal(store.picks.has("thr_one"), false);
});

test("does not make the thread's own window while another is picked", async () => {
  const rex = new FakeRex();
  const main = rex.addSession("main", ["editor"]);
  const store = storage();
  const [editor] = main.windows;
  assert.ok(editor !== undefined);
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: editor.id,
    blockId: null,
  });

  const shown = await ensure(rex, store);
  assert.equal(shown.windowId, editor.id);
  assert.equal(rex.sessions.length, 1, "no session was created");
  assert.equal(store.records.size, 0);
});

test("says so when the picked window has no terminal", async () => {
  const { rex, store, main, server } = await setup();
  server.blocks.length = 0;
  server.focusedBlockId = null;
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: null,
  });
  await assert.rejects(ensure(rex, store), (error) => {
    assert.ok(error instanceof PaneError);
    assert.equal(error.code, "no_terminal");
    assert.match(error.message, /go back to the thread's own/);
    return true;
  });
  assert.equal(
    store.picks.has("thr_one"),
    true,
    "the pick stays to be changed",
  );
});

test("a pane can be picked in the thread's own window, which stays its own", async () => {
  const { rex, store, own } = await setup();
  const window = rex.sessions
    .flatMap((session) => session.windows)
    .find((candidate) => candidate.id === own.windowId);
  assert.ok(window !== undefined);
  const second = rex.split(window, "tests");
  store.picks.set("thr_one", {
    sessionId: own.sessionId,
    windowId: own.windowId,
    blockId: second.id,
  });

  const shown = await ensure(rex, store);
  assert.equal(shown.blockId, second.id);
  assert.equal(shown.own, true);
  assert.equal(shown.windowLabel, OWN_LABEL);
});

test("forgets a pane picked in an own window that was closed in Rex", async () => {
  const { rex, store, own } = await setup();
  store.picks.set("thr_one", {
    sessionId: own.sessionId,
    windowId: own.windowId,
    blockId: own.blockId,
  });
  const session = rex.sessions.find(
    (candidate) => candidate.id === own.sessionId,
  );
  assert.ok(session !== undefined);
  session.windows.length = 0;

  const shown = await ensure(rex, store);
  assert.notEqual(shown.windowId, own.windowId);
  assert.equal(shown.own, true);
  assert.equal(store.picks.has("thr_one"), false);
});

test("ignores a stored pick that is not one", async () => {
  const { rex, store, own } = await setup();
  const junk = { get: () => Promise.resolve({ sessionId: "", windowId: 3 }) };
  const shown = await ensureThreadWindow(rex, {
    sessionLabel: "bb",
    loadThread: () => Promise.resolve(THREAD),
    windows: store.windows,
    views: { ...store.views, ...junk },
  });
  assert.equal(shown.windowId, own.windowId);
});

test("archiving closes the thread's own window, never the one picked", async () => {
  const { rex, store, own, main, server } = await setup();
  store.picks.set("thr_one", {
    sessionId: main.id,
    windowId: server.id,
    blockId: null,
  });
  await closeThreadWindow({
    threadId: "thr_one",
    windows: store.windows,
    connect: () => Promise.resolve({ rex, close: () => {} }),
  });
  assert.equal(main.windows.includes(server), true);
  const ownSession = rex.sessions.find(
    (candidate) => candidate.id === own.sessionId,
  );
  assert.deepEqual(ownSession?.windows, []);
});
