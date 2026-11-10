// bb-plugin-rex — the plugin's backend.
//
// The browser cannot reach the Rex server's Unix socket, so this relays for
// it. Five routes, all for the plugin's own tab:
//
//   - `GET /stream?thread=<id>` opens the terminal of the Rex window that
//     thread shows, making the thread's own window the first time, and
//     answers with its byte stream for as long as the tab reads it
//   - `POST /input` takes the tab's keys, pastes, focus changes, panel size and
//     terminal colors for an open stream and passes them to Rex in order
//   - `GET /targets?thread=<id>` lists the windows the thread could show
//     instead, and `POST /target` picks one, or goes back to its own
//   - `GET /ghostty-vt.wasm` serves the vendored libghostty-vt build the tab
//     decodes the stream with
//
// The stream is relayed as it arrives and never interpreted here; app.tsx
// decodes it.
//
// It also closes a thread's window when the thread is archived or deleted,
// and registers `bb rex target`, with which an agent finds its thread's
// terminal. The skill in skills/ tells agents when and how to use it.

import { readFile, stat } from "node:fs/promises";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { PANE_HEADERS, PaneError } from "./lib/pane-error.ts";
import { paneInputBatchSchema } from "./lib/pane-input.ts";
import { RexControl } from "./lib/rex-control.ts";
import { targetCli } from "./lib/target-command.ts";
import { listWindows } from "./lib/rex-directory.ts";
import { openPane, type PaneStream } from "./lib/rex-pane.ts";
import { findRexSocket } from "./lib/rex-socket.ts";
import { setTargetSchema, targetExists, type Targets } from "./lib/targets.ts";
import {
  THREAD_VIEW_KEY_PREFIX,
  threadViewSchema,
  type ThreadViewStore,
} from "./lib/thread-view.ts";
import {
  closeThreadWindow,
  ensureThreadWindow,
  THREAD_WINDOW_KEY_PREFIX,
  type ThreadForWindow,
  type ThreadWindowRecord,
  type ThreadWindowStore,
} from "./lib/thread-window.ts";

// Path installs load this file as it is. Managed installs load the bundle in
// dist/, one directory further from the vendored file.
const WASM_LOCATIONS = [
  new URL("./vendor/ghostty-vt.wasm", import.meta.url),
  new URL("../vendor/ghostty-vt.wasm", import.meta.url),
];

async function readWasm(): Promise<Uint8Array<ArrayBuffer>> {
  for (const location of WASM_LOCATIONS) {
    try {
      return new Uint8Array(await readFile(location));
    } catch {
      // Try the next location.
    }
  }
  throw new Error("vendor/ghostty-vt.wasm is missing from the plugin.");
}

function toPaneError(error: unknown): PaneError {
  if (error instanceof PaneError) return error;
  return new PaneError(
    "internal",
    error instanceof Error ? error.message : String(error),
  );
}

/** Whether `path` is a directory on this machine. */
async function isLocalDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    sessionLabel: {
      type: "string",
      label: "Rex session label",
      description:
        "Each thread that uses Rex gets its own window in the Rex session with this label. The session is created if no session has the label.",
      default: "bb",
    },
  });

  // The threads the plugin has made a window for, kept in memory as well as
  // in storage, because the instructions hook below cannot wait for storage.
  // It is read here, before anything is registered, so that no agent session
  // starts while it is still empty and no archive is undone by a late read.
  const threadsWithWindow = new Set(
    (await bb.storage.kv.list(THREAD_WINDOW_KEY_PREFIX)).map((key) =>
      key.slice(THREAD_WINDOW_KEY_PREFIX.length),
    ),
  );
  const windows: ThreadWindowStore = {
    get: (threadId) =>
      bb.storage.kv.get<unknown>(THREAD_WINDOW_KEY_PREFIX + threadId),
    set: async (threadId, record: ThreadWindowRecord) => {
      await bb.storage.kv.set(THREAD_WINDOW_KEY_PREFIX + threadId, record);
      threadsWithWindow.add(threadId);
    },
    delete: async (threadId) => {
      await bb.storage.kv.delete(THREAD_WINDOW_KEY_PREFIX + threadId);
      threadsWithWindow.delete(threadId);
    },
  };

  const views: ThreadViewStore = {
    get: (threadId) =>
      bb.storage.kv.get<unknown>(THREAD_VIEW_KEY_PREFIX + threadId),
    set: (threadId, view) =>
      bb.storage.kv.set(THREAD_VIEW_KEY_PREFIX + threadId, view),
    delete: (threadId) =>
      bb.storage.kv.delete(THREAD_VIEW_KEY_PREFIX + threadId),
  };

  /** Runs `task` on a control connection to Rex that is closed afterwards. */
  async function withRex<T>(task: (rex: RexControl) => Promise<T>): Promise<T> {
    const control = await RexControl.connect(await findRexSocket());
    try {
      return await task(control);
    } finally {
      control.close();
    }
  }

  /** What a window for the thread is made from, if the thread may have one. */
  async function threadForWindow(threadId: string): Promise<ThreadForWindow> {
    const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
    if (thread === null || thread.deletedAt !== null) {
      throw new PaneError("bad_thread", "bb could not find this thread.");
    }
    if (thread.archivedAt !== null) {
      throw new PaneError(
        "bad_thread",
        "This thread is archived, and its Rex window was closed with it. Unarchive the thread to use Rex here.",
      );
    }
    // The shell starts in the thread's workspace when that is on this
    // machine, where the Rex server is. A workspace on another machine has a
    // path that means something else here, even if a directory of the same
    // name exists, so such a thread gets the default directory.
    let cwd: string | null = null;
    if (thread.environmentId !== null) {
      const [environment, config] = await Promise.all([
        bb.sdk.environments
          .get({ environmentId: thread.environmentId })
          .catch(() => null),
        bb.sdk.system.config().catch(() => null),
      ]);
      const path = environment?.path ?? null;
      const here = config?.primaryHostId ?? null;
      if (
        path !== null &&
        here !== null &&
        environment?.hostId === here &&
        (await isLocalDirectory(path))
      ) {
        cwd = path;
      }
    }
    return { id: threadId, title: thread.title ?? thread.titleFallback, cwd };
  }

  /** The label of the session new thread windows go in. */
  async function sessionLabel(): Promise<string> {
    const label = (await settings.get()).sessionLabel.trim();
    if (label === "") {
      throw new PaneError(
        "no_terminal",
        "The plugin's Rex session label setting is empty.",
      );
    }
    return label;
  }

  // An agent asking for its thread's terminal goes through the same
  // operation as the tab, so both land in the same window.
  bb.cli.register(
    targetCli(async (threadId) => {
      const label = await sessionLabel();
      return withRex((rex) =>
        ensureThreadWindow(rex, {
          sessionLabel: label,
          loadThread: () => threadForWindow(threadId),
          windows,
          views,
        }),
      );
    }),
  );

  // Only a thread that already has a Rex window is told about it. A thread
  // that has never used Rex gets no instructions from this plugin.
  bb.agents.contributeInstructions(({ threadId }) =>
    threadsWithWindow.has(threadId)
      ? "This thread has a Rex terminal that the user can watch and type in from bb's Rex tab or from Rex. Before you run a command that the user should see or may want to take over, load the `rex-thread-terminal` skill."
      : null,
  );

  const open = new Map<string, PaneStream>();
  bb.onDispose(() => {
    for (const pane of open.values()) pane.close();
  });

  bb.http.route("GET", "/stream", async (context) => {
    let pane: PaneStream;
    try {
      const threadId = context.req.query("thread") ?? "";
      if (threadId === "") {
        throw new PaneError("bad_thread", "The request names no thread.");
      }
      pane = await openPane({
        socketPath: await findRexSocket(),
        sessionLabel: await sessionLabel(),
        loadThread: () => threadForWindow(threadId),
        windows,
        views,
      });
    } catch (error) {
      const failure = toPaneError(error);
      bb.log.warn(`stream not opened: ${failure.code}: ${failure.message}`);
      return context.json(failure.toBody(), failure.status);
    }

    open.set(pane.id, pane);
    void pane.closed.then(() => open.delete(pane.id));
    // The tab may have gone away while the pane was being opened.
    const { signal } = context.req.raw;
    if (signal.aborted) pane.close();
    else signal.addEventListener("abort", () => pane.close());

    return new Response(pane.body, {
      headers: {
        // Not a type bb's compression middleware touches, and marked so no
        // layer may buffer it: small chunks have to reach the tab at once.
        "content-type": "application/octet-stream",
        "cache-control": "no-store, no-transform",
        [PANE_HEADERS.pane]: pane.id,
        [PANE_HEADERS.nonce]: pane.nonce,
        [PANE_HEADERS.sessionLabel]: encodeURIComponent(pane.sessionLabel),
        [PANE_HEADERS.windowLabel]: encodeURIComponent(pane.windowLabel),
        [PANE_HEADERS.window]: pane.ownWindow ? "own" : "picked",
        [PANE_HEADERS.claim]: pane.claimsPane ? "claimed" : "none",
      },
    });
  });

  bb.http.route("POST", "/input", async (context) => {
    try {
      const batch = paneInputBatchSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!batch.success) {
        throw new PaneError(
          "bad_input",
          "The input is not in a shape the plugin accepts.",
        );
      }
      const pane = open.get(batch.data.pane);
      if (pane === undefined) {
        throw new PaneError(
          "pane_closed",
          "The terminal stream this input is for has ended.",
        );
      }
      await pane.input(batch.data.events);
      return context.body(null, 204);
    } catch (error) {
      const failure = toPaneError(error);
      return context.json(failure.toBody(), failure.status);
    }
  });

  bb.http.route("GET", "/targets", async (context) => {
    try {
      const threadId = context.req.query("thread") ?? "";
      await threadForWindow(threadId);
      const [sessions, own, pick] = await Promise.all([
        withRex(listWindows),
        windows.get(threadId),
        views.get(threadId),
      ]);
      const ownWindow = threadViewSchema
        .pick({ sessionId: true, windowId: true })
        .safeParse(own);
      const picked = threadViewSchema.safeParse(pick);
      const targets: Targets = {
        sessions,
        own: ownWindow.success ? ownWindow.data : null,
        pick: picked.success ? picked.data : null,
      };
      return context.json(targets);
    } catch (error) {
      const failure = toPaneError(error);
      return context.json(failure.toBody(), failure.status);
    }
  });

  bb.http.route("POST", "/target", async (context) => {
    try {
      const body = setTargetSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!body.success) {
        throw new PaneError(
          "bad_input",
          "The pick is not in a shape the plugin accepts.",
        );
      }
      const { thread: threadId, target } = body.data;
      await threadForWindow(threadId);
      if (target === null) {
        await views.delete(threadId);
      } else {
        // Only a window that is there now can be picked.
        if (!targetExists(await withRex(listWindows), target)) {
          throw new PaneError(
            "no_terminal",
            "That window or pane is no longer there. Open the menu again to see what is.",
          );
        }
        await views.set(threadId, target);
      }
      return context.body(null, 204);
    } catch (error) {
      const failure = toPaneError(error);
      return context.json(failure.toBody(), failure.status);
    }
  });

  bb.http.route("GET", "/ghostty-vt.wasm", async () => {
    return new Response(await readWasm(), {
      headers: {
        "content-type": "application/wasm",
        "cache-control": "no-cache",
      },
    });
  });

  /**
   * Closes the window the plugin made for a thread that is archived or
   * deleted. A thread that never used Rex has no record, and Rex is not
   * contacted for it.
   */
  const closeWindowOf = async (threadId: string) => {
    // A pick is only a note of what to show. The window picked is not the
    // plugin's and is left as it is.
    await views.delete(threadId);
    return closeThreadWindow({
      threadId,
      windows,
      connect: async () => {
        const control = await RexControl.connect(await findRexSocket());
        return { rex: control, close: () => control.close() };
      },
    });
  };

  const closeForEvent = (threadId: string): Promise<void> =>
    closeWindowOf(threadId).then(
      () => {},
      (error: unknown) => {
        // The record stays, and the next load of the plugin tries again.
        bb.log.warn(
          `could not close the Rex window of ${threadId}: ${toPaneError(error).message}`,
        );
      },
    );
  bb.events.on("thread.archived", ({ thread }) => closeForEvent(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => closeForEvent(thread.id));

  // An archive or delete while the plugin was not loaded sent it no event.
  // Catch up once: close the window of every recorded thread that bb says is
  // archived or deleted. A thread bb cannot be asked about keeps its window:
  // a failed request must not end the programs running in it.
  void (async () => {
    // A close removes its thread from the set, which a set allows while it
    // is being walked.
    for (const threadId of threadsWithWindow) {
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      if (thread === null) continue;
      if (thread.archivedAt !== null || thread.deletedAt !== null) {
        await closeForEvent(threadId);
      }
    }
  })().catch((error: unknown) => {
    bb.log.warn(`catch-up failed: ${toPaneError(error).message}`);
  });
}
