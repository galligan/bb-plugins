// A thread's own Rex window: found, or created the first time the thread
// uses Rex, and closed when the thread is archived.
//
// A Rex "tab" is a window. Each bb thread that uses Rex gets one window with
// one shell in it, in the session the plugin's `sessionLabel` setting names,
// labelled with the thread's title and ID so the two can be matched by eye.
// The label is for people: the plugin finds the window by the IDs it recorded
// when it made it, and only ever closes a window it has such a record for.
//
// Every way a thread can come to use Rex goes through `ensureThreadWindow`,
// so the Rex tab and an agent asking for the thread's terminal land in the
// same window.

import { z } from "zod";

import { PaneError } from "./pane-error.ts";
import type { RexCaller } from "./rex-control.ts";
import {
  chooseSession,
  chooseWindowPane,
  sessionListSchema,
  sessionViewSchema,
  SHELL_FLAVOR,
} from "./session.ts";
import { threadWindowLabel } from "./window-label.ts";

/** The storage key prefix a thread's window record is kept under. */
export const THREAD_WINDOW_KEY_PREFIX = "thread-window:";

const recordSchema = z.object({
  sessionId: z.string(),
  windowId: z.string(),
});

/** The window the plugin made for a thread. */
export type ThreadWindowRecord = z.infer<typeof recordSchema>;

/** Where the plugin keeps each thread's window record, by thread ID. */
export interface ThreadWindowStore {
  get(threadId: string): Promise<unknown>;
  set(threadId: string, record: ThreadWindowRecord): Promise<void>;
  delete(threadId: string): Promise<void>;
}

/** What the window is made from. */
export interface ThreadForWindow {
  id: string;
  /** The thread's title, or null while it has none. */
  title: string | null;
  /** A directory on the Rex server's machine to start the shell in. */
  cwd: string | null;
}

/** A thread's window and the terminal pane to use in it. */
export interface ThreadWindow {
  sessionId: string;
  windowId: string;
  blockId: string;
  /** The window's label, as it now is in Rex. */
  windowLabel: string;
  /**
   * The ID of the connection's client in the session. Rex takes changes to a
   * session only from a connection attached to it, so finding or making the
   * window leaves the connection attached.
   */
  clientId: string;
}

const attachedSchema = z.object({
  client_id: z.string(),
  view: sessionViewSchema,
});

/** Attaches the connection to a session, which changes to it require. */
const attach = (rex: RexCaller, sessionId: string) =>
  rex.call("session.attach", { session_id: sessionId }, attachedSchema);

const newWindowSchema = z.object({
  window_id: z.string(),
  block_ids: z.array(z.string()).min(1),
});

const createdSessionSchema = z.object({
  session_id: z.string(),
  initial_windows: z.array(newWindowSchema).min(1),
});

/** Whether Rex refused a call because what it named is not there. */
function isGone(error: unknown): boolean {
  return (
    error instanceof PaneError &&
    (error.rexCode === "not_found" || error.rexCode === "session_not_found")
  );
}

// Two requests for the same thread must not both find no window and both
// make one, and two for different threads must not both find the session
// missing and both create it. Closing takes its turn with them too, so an
// archive that arrives while a window is being made waits, then closes it.
// Lookups are quick, so they all simply take turns.
let turns: Promise<unknown> = Promise.resolve();

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const result = turns.then(task, task);
  turns = result.catch(() => {});
  return result;
}

/** What finding or making a thread's window needs. */
export interface EnsureOptions {
  sessionLabel: string;
  /**
   * Reads the thread, and throws if it may not have a window, such as when
   * it is archived. It is called once the request's turn has come, so that a
   * thread archived while the request waited gets no window.
   */
  loadThread: () => Promise<ThreadForWindow>;
  windows: ThreadWindowStore;
}

/**
 * Finds the window the plugin made for the thread, or makes it: in the
 * session labelled `sessionLabel`, which is created with this window as its
 * first if no session has that label. Brings the window's label back in line
 * with the thread's title.
 */
export function ensureThreadWindow(
  rex: RexCaller,
  options: EnsureOptions,
): Promise<ThreadWindow> {
  return inTurn(() => ensure(rex, options));
}

async function ensure(
  rex: RexCaller,
  options: EnsureOptions,
): Promise<ThreadWindow> {
  const { sessionLabel, windows } = options;
  const thread = await options.loadThread();
  const windowLabel = threadWindowLabel(thread.title, thread.id);

  const list = await rex.call("session.list", undefined, sessionListSchema);
  const live = (list.sessions ?? []).map((session) => session.session_id);

  const record = recordSchema.safeParse(await windows.get(thread.id));
  if (record.success && live.includes(record.data.sessionId)) {
    const existing = await useExisting(rex, record.data, windowLabel);
    if (existing !== null) return existing;
  }

  // No window yet, or the one recorded was closed in Rex: make one.
  const layout = {
    block: {
      flavor: SHELL_FLAVOR,
      ...(thread.cwd === null ? {} : { options: { cwd: thread.cwd } }),
    },
  };
  const choice = chooseSession(list, sessionLabel);
  if (choice.kind === "ambiguous") {
    throw new PaneError(
      "ambiguous_label",
      `${choice.count} Rex sessions are labelled "${sessionLabel}", so the plugin cannot tell which should hold this thread's terminal. Rename all but one, or set the plugin's session label to a name only one session has.`,
    );
  }
  let made: ThreadWindow;
  if (choice.kind === "missing") {
    const created = await rex.call(
      "session.create",
      {
        label: sessionLabel,
        initial_windows: [{ window_label: windowLabel, layout }],
      },
      createdSessionSchema,
    );
    const [first] = created.initial_windows;
    const { client_id } = await attach(rex, created.session_id);
    made = toWindow(created.session_id, first, windowLabel, client_id);
  } else {
    const { client_id } = await attach(rex, choice.sessionId);
    const created = await rex.call(
      "session.new_window",
      {
        session_id: choice.sessionId,
        window_label: windowLabel,
        layout,
        // The user may be working in another window of this session.
        focus: false,
      },
      newWindowSchema,
    );
    made = toWindow(choice.sessionId, created, windowLabel, client_id);
  }
  try {
    await windows.set(thread.id, {
      sessionId: made.sessionId,
      windowId: made.windowId,
    });
  } catch (error) {
    // A window with no record could never be found again or closed with
    // its thread, so it is not left behind. Only the window is closed, even
    // when its session was created for it: someone may have opened a window
    // of their own there since, and an empty session does no harm.
    await rex
      .call(
        "session.close_window",
        { session_id: made.sessionId, window_id: made.windowId },
        z.unknown(),
      )
      .catch(() => {});
    throw error;
  }
  return made;
}

function toWindow(
  sessionId: string,
  created: z.infer<typeof newWindowSchema> | undefined,
  windowLabel: string,
  clientId: string,
): ThreadWindow {
  const blockId = created?.block_ids[0];
  if (created === undefined || blockId === undefined) {
    throw new PaneError("rex_refused", "Rex created a window with no pane.");
  }
  return {
    sessionId,
    windowId: created.window_id,
    blockId,
    windowLabel,
    clientId,
  };
}

/** The recorded window, relabelled if need be, or null if it is gone. */
async function useExisting(
  rex: RexCaller,
  record: ThreadWindowRecord,
  windowLabel: string,
): Promise<ThreadWindow | null> {
  const { client_id: clientId, view } = await attach(rex, record.sessionId);
  const window = (view.windows ?? []).find(
    (candidate) => candidate.window_id === record.windowId,
  );
  if (window === undefined) return null;
  if (window.label !== windowLabel) {
    await rex.call(
      "session.set_window_label",
      {
        session_id: record.sessionId,
        window_id: record.windowId,
        label: windowLabel,
      },
      z.unknown(),
    );
  }
  const pane = chooseWindowPane(view, record.windowId);
  if (pane.kind === "none") {
    throw new PaneError(
      "no_terminal",
      `This thread's Rex window has no terminal to use. ${pane.reason}`,
    );
  }
  return { ...record, blockId: pane.blockId, windowLabel, clientId };
}

/**
 * Closes the window the plugin made for the thread, if it made one, and
 * forgets it. Closing a window ends the programs running in it. Returns
 * whether there was a record. A window that is already gone counts as closed.
 *
 * `connect` is called only when there is a record, so a thread that never
 * used Rex costs no connection.
 */
export function closeThreadWindow(options: {
  threadId: string;
  windows: ThreadWindowStore;
  connect: () => Promise<{ rex: RexCaller; close(): void }>;
}): Promise<boolean> {
  return inTurn(async () => {
    const { threadId, windows } = options;
    const record = recordSchema.safeParse(await windows.get(threadId));
    if (!record.success) return false;
    const { rex, close } = await options.connect();
    try {
      await attach(rex, record.data.sessionId);
      await rex.call(
        "session.close_window",
        {
          session_id: record.data.sessionId,
          window_id: record.data.windowId,
        },
        z.unknown(),
      );
    } catch (error) {
      // Anything else leaves the record, so a later attempt can close it.
      if (!isGone(error)) throw error;
    } finally {
      close();
    }
    await windows.delete(threadId);
    return true;
  });
}
