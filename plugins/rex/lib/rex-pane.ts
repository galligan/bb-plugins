// Opens one Rex terminal pane as a byte stream.
//
// Each open stream holds its own control connection and one data connection.
// Rex ends a stream when the client that opened it leaves, so the control
// connection stays open for as long as the stream does.
//
// The plugin is read-only towards Rex. It never claims a block and never
// requests a size or theme, because a terminal follows its owner and either
// call would resize or recolor the pane in the user's own Rex client.

import type WebSocket from "ws";
import { z } from "zod";

import {
  describeReject,
  encodeDataHello,
  parseDataHandshakeReply,
} from "./data-handshake.ts";
import { PaneError } from "./pane-error.ts";
import { openRexSocket, RexControl, toBuffer } from "./rex-control.ts";
import {
  choosePane,
  chooseSession,
  sessionListSchema,
  sessionViewSchema,
  SHELL_FLAVOR,
} from "./session.ts";

const DATA_SUBPROTOCOL = "rex.data.terminal.v1";
const HANDSHAKE_TIMEOUT_MS = 10_000;
/**
 * Bytes queued for the viewer before reading from Rex is paused. A stream can
 * open with a snapshot of tens of megabytes, sent faster than a browser takes
 * it, so the queue is kept short by slowing the source, not by giving up.
 */
const QUEUE_BYTES = 1024 * 1024;

export interface PaneStream {
  /** Marks Rex's own messages in `body`. */
  readonly nonce: string;
  readonly sessionLabel: string;
  /** Whether this call created the session because none had the label. */
  readonly created: boolean;
  /** The terminal stream: a Ghostty snapshot, then live output. */
  readonly body: ReadableStream<Uint8Array>;
  /** Resolves when the stream has ended, for whatever reason. */
  readonly closed: Promise<void>;
  /** Ends the stream on the Rex server and closes both connections. */
  close(): void;
}

// Two tabs opening at once must not both find the label missing and both
// create a session, which would leave the label ambiguous from then on.
let sessionLookups: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const result = sessionLookups.then(task, task);
  sessionLookups = result.catch(() => {});
  return result;
}

async function findOrCreateSession(
  control: RexControl,
  label: string,
): Promise<{ sessionId: string; created: boolean }> {
  const list = await control.call("session.list", undefined, sessionListSchema);
  const choice = chooseSession(list, label);
  if (choice.kind === "found") {
    return { sessionId: choice.sessionId, created: false };
  }
  if (choice.kind === "ambiguous") {
    throw new PaneError(
      "ambiguous_label",
      `${choice.count} Rex sessions are labelled "${label}", so the tab cannot tell which to show. Rename all but one, or set the plugin's session label to a name only one session has.`,
    );
  }
  const created = await control.call(
    "session.create",
    {
      label,
      initial_windows: [{ layout: { block: { flavor: SHELL_FLAVOR } } }],
    },
    z.object({ session_id: z.string() }),
  );
  return { sessionId: created.session_id, created: true };
}

/** Opens the focused terminal of the session labelled `label`. */
export async function openPane(options: {
  socketPath: string;
  label: string;
}): Promise<PaneStream> {
  const control = await RexControl.connect(options.socketPath);
  try {
    const { sessionId, created } = await oneAtATime(() =>
      findOrCreateSession(control, options.label),
    );
    const attached = await control.call(
      "session.attach",
      { session_id: sessionId },
      z.object({ view: sessionViewSchema }),
    );
    if (created) {
      // `session.create` makes its caller the owner of the new blocks. Give
      // them up, so the terminal follows whichever Rex client shows it.
      await control.call(
        "session.disown_block",
        { session_id: sessionId },
        z.unknown(),
      );
    }
    const pane = choosePane(attached.view);
    if (pane.kind === "none") {
      throw new PaneError(
        "no_terminal",
        `Rex session "${options.label}" has no terminal to show. ${pane.reason}`,
      );
    }
    const { ticket } = await control.call(
      "data.connect",
      {
        session_id: sessionId,
        block_id: pane.blockId,
        data_ref_id: "terminal",
        subprotocol: DATA_SUBPROTOCOL,
      },
      z.object({ ticket: z.string() }),
    );
    const hello = encodeDataHello(ticket);
    const data = await openRexSocket(
      options.socketPath,
      "/api/data",
      DATA_SUBPROTOCOL,
    );
    return await relay({
      control,
      data,
      hello,
      sessionLabel: options.label,
      created,
    });
  } catch (error) {
    control.close();
    throw error;
  }
}

/** Completes the data handshake, then passes every stream byte to `body`. */
function relay(options: {
  control: RexControl;
  data: WebSocket;
  hello: Uint8Array;
  sessionLabel: string;
  created: boolean;
}): Promise<PaneStream> {
  const { control, data } = options;
  return new Promise((resolve, reject) => {
    let phase: "handshake" | "stream" | "closed" = "handshake";
    let markClosed = () => {};
    const closed = new Promise<void>((done) => {
      markClosed = done;
    });

    const streamHolder: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          streamHolder.controller = controller;
        },
        // The viewer has room again.
        pull: () => data.resume(),
        // The viewer went away: the tab closed or its request was aborted.
        cancel: () => finish(),
      },
      new ByteLengthQueuingStrategy({ highWaterMark: QUEUE_BYTES }),
    );

    const handshakeTimer = setTimeout(
      () =>
        finish(
          new PaneError(
            "rex_refused",
            "Rex did not answer the data handshake.",
          ),
        ),
      HANDSHAKE_TIMEOUT_MS,
    );

    function finish(failure?: Error): void {
      if (phase === "closed") return;
      const wasHandshake = phase === "handshake";
      phase = "closed";
      clearTimeout(handshakeTimer);
      // Status 1000 ends the stream on the server instead of leaving it
      // waiting for a resume. A paused socket would not see the close through.
      data.resume();
      data.close(1000);
      control.close();
      try {
        if (failure === undefined) streamHolder.controller?.close();
        else streamHolder.controller?.error(failure);
      } catch {
        // The viewer already cancelled the stream.
      }
      markClosed();
      if (wasHandshake) {
        reject(
          failure ??
            new PaneError(
              "rex_refused",
              "Rex closed the data connection during the handshake.",
            ),
        );
      }
    }

    data.on("message", (raw) => {
      const bytes = toBuffer(raw);
      if (phase === "stream") {
        const controller = streamHolder.controller;
        if (controller === null) return;
        controller.enqueue(bytes);
        // Stop reading from Rex while the viewer is behind. The socket then
        // fills and Rex waits, so no more than the queue is ever held here.
        // A viewer that never reads again is dropped by Rex's own keepalive.
        if ((controller.desiredSize ?? 0) <= 0) data.pause();
        return;
      }
      if (phase !== "handshake") return;
      try {
        const reply = parseDataHandshakeReply(bytes);
        if (reply.kind === "reject") {
          throw new PaneError(
            "rex_refused",
            `Rex rejected the data connection: ${describeReject(reply.reason)}.`,
          );
        }
        clearTimeout(handshakeTimer);
        phase = "stream";
        resolve({
          nonce: reply.nonce,
          sessionLabel: options.sessionLabel,
          created: options.created,
          body,
          closed,
          close: () => finish(),
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    data.on("close", () => finish());
    control.onClose(() => finish());

    data.send(options.hello);
  });
}
