import assert from "node:assert/strict";
import { test } from "node:test";

import { FakeRex } from "./fake-rex.ts";
import { PaneError } from "./pane-error.ts";
import {
  closeThreadWindow,
  ensureThreadWindow,
  type ThreadForWindow,
  type ThreadWindowRecord,
} from "./thread-window.ts";

const THREAD: ThreadForWindow = {
  id: "thr_one",
  title: "Fix the login redirect",
  cwd: "/work/one",
};
const LABEL = "Fix the login redirect [thr_one]";

/** The plugin's storage, in memory. */
function storage() {
  const records = new Map<string, ThreadWindowRecord>();
  return {
    records,
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
  };
}

const ensure = (
  rex: FakeRex,
  store: ReturnType<typeof storage>,
  thread = THREAD,
  sessionLabel = "bb",
) =>
  ensureThreadWindow(rex, {
    sessionLabel,
    thread,
    windows: store.windows,
  });

test("creates the session with the thread's window as its first", async () => {
  const rex = new FakeRex();
  rex.addSession("main");
  const store = storage();

  const window = await ensure(rex, store);
  const session = rex.sessions.find((candidate) => candidate.label === "bb");
  assert.ok(session !== undefined);
  assert.deepEqual(
    session.windows.map((made) => made.label),
    [LABEL],
    "no stray window beside it",
  );
  assert.equal(session.windows[0]?.blocks[0]?.cwd, "/work/one");
  assert.deepEqual(window, {
    sessionId: session.id,
    windowId: session.windows[0]?.id,
    blockId: session.windows[0]?.blocks[0]?.id,
    windowLabel: LABEL,
    clientId: "client:test",
  });
  assert.deepEqual(rex.methods, [
    "session.list",
    "session.create",
    "session.attach",
  ]);
  assert.deepEqual(store.records.get("thr_one"), {
    sessionId: session.id,
    windowId: window.windowId,
  });
});

test("adds a window to a session that exists, without taking its focus", async () => {
  const rex = new FakeRex();
  const session = rex.addSession("bb", ["mine"]);
  const active = session.activeWindowId;
  const store = storage();

  const window = await ensure(rex, store);
  assert.deepEqual(
    session.windows.map((made) => made.label),
    ["mine", LABEL],
  );
  assert.equal(window.sessionId, session.id);
  assert.equal(session.activeWindowId, active);
});

test("starts the shell in the default directory when given none", async () => {
  const rex = new FakeRex();
  const store = storage();
  await ensure(rex, store, { ...THREAD, cwd: null });
  assert.equal(rex.sessions[0]?.windows[0]?.blocks[0]?.cwd, null);
});

test("finds the window again by the IDs it recorded", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);
  rex.calls.length = 0;

  const again = await ensure(rex, store);
  assert.deepEqual(again, first);
  assert.deepEqual(rex.methods, ["session.list", "session.attach"]);
  assert.equal(rex.sessions[0]?.windows.length, 1);
});

test("gives each thread its own window in the one session", async () => {
  const rex = new FakeRex();
  const store = storage();
  const one = await ensure(rex, store);
  const two = await ensure(rex, store, {
    id: "thr_two",
    title: "Another",
    cwd: null,
  });
  assert.equal(rex.sessions.length, 1);
  assert.equal(two.sessionId, one.sessionId);
  assert.notEqual(two.windowId, one.windowId);
  assert.deepEqual(
    rex.sessions[0]?.windows.map((made) => made.label),
    [LABEL, "Another [thr_two]"],
  );
});

test("requests made at once for one thread share one window", async () => {
  const rex = new FakeRex();
  const store = storage();
  const [tab, agent] = await Promise.all([
    ensure(rex, store),
    ensure(rex, store),
  ]);
  assert.deepEqual(agent, tab);
  assert.equal(rex.sessions.length, 1);
  assert.equal(rex.sessions[0]?.windows.length, 1);
});

test("brings the label back in line when the thread's title has changed", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);

  const renamed = await ensure(rex, store, { ...THREAD, title: "Fix login" });
  assert.equal(renamed.windowId, first.windowId);
  assert.equal(renamed.windowLabel, "Fix login [thr_one]");
  assert.equal(rex.sessions[0]?.windows[0]?.label, "Fix login [thr_one]");
});

test("finds a window the user relabelled, and labels it again", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);
  const made = rex.sessions[0]?.windows[0];
  assert.ok(made !== undefined);
  made.label = "scratch";

  const again = await ensure(rex, store);
  assert.equal(again.windowId, first.windowId);
  assert.equal(made.label, LABEL);
});

test("makes a new window when the recorded one was closed in Rex", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);
  const session = rex.sessions[0];
  assert.ok(session !== undefined);
  session.windows.length = 0;

  const second = await ensure(rex, store);
  assert.notEqual(second.windowId, first.windowId);
  assert.equal(second.sessionId, session.id);
  assert.deepEqual(store.records.get("thr_one"), {
    sessionId: session.id,
    windowId: second.windowId,
  });
});

test("makes a new session and window when the recorded session is gone", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);
  rex.sessions.length = 0;

  const second = await ensure(rex, store);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(rex.sessions[0]?.windows[0]?.label, LABEL);
});

test("keeps to the window it made after the session label setting changes", async () => {
  const rex = new FakeRex();
  const store = storage();
  const first = await ensure(rex, store);
  const again = await ensure(rex, store, THREAD, "elsewhere");
  assert.deepEqual(again, first);
  assert.equal(rex.sessions.length, 1);
});

test("does not pick between sessions that share the label", async () => {
  const rex = new FakeRex();
  rex.addSession("bb");
  rex.addSession("bb");
  const store = storage();
  await assert.rejects(ensure(rex, store), (error) => {
    assert.ok(error instanceof PaneError);
    assert.equal(error.code, "ambiguous_label");
    return true;
  });
  assert.equal(store.records.size, 0);
  assert.deepEqual(rex.methods, ["session.list"]);
});

test("ignores a stored record that is not one", async () => {
  const rex = new FakeRex();
  const store = storage();
  const junk = { get: () => Promise.resolve({ sessionId: 7 }) };
  const window = await ensureThreadWindow(rex, {
    sessionLabel: "bb",
    thread: THREAD,
    windows: { ...store.windows, ...junk },
  });
  assert.equal(window.windowLabel, LABEL);
});

test("closes the window it made for a thread, and forgets it", async () => {
  const rex = new FakeRex();
  const session = rex.addSession("bb", ["mine"]);
  const store = storage();
  await ensure(rex, store);
  await ensure(rex, store, { id: "thr_two", title: "Another", cwd: null });

  const closed = await closeThreadWindow(rex, {
    threadId: "thr_one",
    windows: store.windows,
  });
  assert.equal(closed, true);
  assert.deepEqual(
    session.windows.map((made) => made.label),
    ["mine", "Another [thr_two]"],
  );
  assert.equal(store.records.has("thr_one"), false);
  assert.equal(store.records.has("thr_two"), true);
});

test("closes nothing for a thread it made no window for", async () => {
  const rex = new FakeRex();
  const session = rex.addSession("bb", ["Never used Rex [thr_three]"]);
  const store = storage();
  const closed = await closeThreadWindow(rex, {
    threadId: "thr_three",
    windows: store.windows,
  });
  assert.equal(closed, false);
  assert.equal(session.windows.length, 1, "a matching label is not a record");
  assert.deepEqual(rex.methods, []);
});

test("forgets a window that was already closed in Rex", async () => {
  const rex = new FakeRex();
  const store = storage();
  await ensure(rex, store);
  const session = rex.sessions[0];
  assert.ok(session !== undefined);
  session.windows.length = 0;
  assert.equal(
    await closeThreadWindow(rex, {
      threadId: "thr_one",
      windows: store.windows,
    }),
    true,
  );
  assert.equal(store.records.size, 0);

  // And one whose whole session is gone.
  await ensure(rex, store);
  rex.sessions.length = 0;
  await closeThreadWindow(rex, { threadId: "thr_one", windows: store.windows });
  assert.equal(store.records.size, 0);
});

test("keeps the record when the close fails for another reason", async () => {
  const rex = new FakeRex();
  const store = storage();
  await ensure(rex, store);
  const failing = {
    call: () => Promise.reject(new PaneError("rex_unreachable", "no answer")),
  };
  await assert.rejects(
    closeThreadWindow(failing, {
      threadId: "thr_one",
      windows: store.windows,
    }),
  );
  assert.equal(store.records.has("thr_one"), true);
});
