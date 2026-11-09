// Opens one Rex terminal pane: its byte stream out, and input back in.
//
// Each open pane holds its own control connection and one data connection.
// Rex ends a stream when the client that opened it leaves, so the control
// connection stays open for as long as the stream does. Input for the pane
// goes out on that same control connection, which is what keeps it in order.
//
// Typing goes to whichever pane the tab shows. Claiming a pane and asking for
// a size do not: a terminal follows its owner, so those would resize the pane
// in the user's own Rex client. pane-sizing.ts holds the rule for when the
// tab may, and it only ever applies to a session this plugin created.

import { randomUUID } from "node:crypto";

import type WebSocket from "ws";
import { z } from "zod";

import {
  readCreatedSessions,
  updateCreatedSessions,
} from "./created-sessions.ts";
import {
  describeReject,
  encodeDataHello,
  parseDataHandshakeReply,
} from "./data-handshake.ts";
import { PaneError } from "./pane-error.ts";
import { blockEventFor, type GridSize, type PaneInput } from "./pane-input.ts";
import { ownerChange, PaneSizing } from "./pane-sizing.ts";
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

/** The terminal's bytes, and the means to stop them. */
interface Relay {
  /** Marks Rex's own messages in `body`. */
  readonly nonce: string;
  /** The terminal stream: a Ghostty snapshot, then live output. */
  readonly body: ReadableStream<Uint8Array>;
  /** Resolves when the stream has ended, for whatever reason. */
  readonly closed: Promise<void>;
  /** Ends the stream on the Rex server and closes both connections. */
  close(): void;
}

export interface PaneStream extends Relay {
  /** Names this open pane to the tab, which sends it back with its input. */
  readonly id: string;
  readonly sessionLabel: string;
  /** Whether the tab should report the size its panel has room for. */
  readonly fitsPanel: boolean;
  /**
   * Delivers the tab's input to the pane, in order. Resolves once Rex has
   * taken all of it.
   */
  input(events: readonly PaneInput[]): Promise<void>;
}

/** Where the plugin keeps the IDs of the sessions it created. */
export interface CreatedSessionsStore {
  read(): Promise<unknown>;
  write(sessionIds: string[]): Promise<void>;
}

// Two tabs opening at once must not both find the label missing and both
// create a session, which would leave the label ambiguous from then on.
let sessionLookups: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const result = sessionLookups.then(task, task);
  sessionLookups = result.catch(() => {});
  return result;
}

/**
 * Finds the session labelled `label`, or creates it with one shell. `ours`
 * says whether this plugin created it, now or on an earlier open.
 */
async function findOrCreateSession(
  control: RexControl,
  label: string,
  store: CreatedSessionsStore,
): Promise<{ sessionId: string; ours: boolean }> {
  const list = await control.call("session.list", undefined, sessionListSchema);
  const live = (list.sessions ?? []).map((session) => session.session_id);
  const stored = readCreatedSessions(await store.read());
  const recorded = updateCreatedSessions(stored, live);
  if (recorded.length !== stored.length) await store.write(recorded);
  const choice = chooseSession(list, label);
  if (choice.kind === "found") {
    return {
      sessionId: choice.sessionId,
      ours: recorded.includes(choice.sessionId),
    };
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
  await store.write(updateCreatedSessions(recorded, live, created.session_id));
  return { sessionId: created.session_id, ours: true };
}

const ownedBlocksSchema = z.object({
  blocks: z
    .array(
      z.object({
        block_id: z.string().nullable(),
        owner: z.string().nullish(),
      }),
    )
    .nullable(),
});

/** Opens the focused terminal of the session labelled `label`. */
export async function openPane(options: {
  socketPath: string;
  label: string;
  createdSessions: CreatedSessionsStore;
}): Promise<PaneStream> {
  const control = await RexControl.connect(options.socketPath);
  try {
    const { sessionId, ours } = await oneAtATime(() =>
      findOrCreateSession(control, options.label, options.createdSessions),
    );
    const attached = await control.call(
      "session.attach",
      { session_id: sessionId },
      z.object({ client_id: z.string(), view: sessionViewSchema }),
    );
    const pane = choosePane(attached.view);
    if (pane.kind === "none") {
      throw new PaneError(
        "no_terminal",
        `Rex session "${options.label}" has no terminal to show. ${pane.reason}`,
      );
    }
    const block = { session_id: sessionId, block_id: pane.blockId };

    const sizing = new PaneSizing({
      mayClaim: ours,
      clientId: attached.client_id,
      request: (size) => void requestSize(control, block, size),
    });
    control.onMessage((message) => {
      const owner = ownerChange(message, { sessionId, blockId: pane.blockId });
      if (owner !== undefined) sizing.ownerIs(owner);
    });
    if (sizing.mayClaim) {
      const owned = await control.call(
        "session.own_block",
        { session_id: sessionId, block_ids: [pane.blockId], mode: "take" },
        ownedBlocksSchema,
      );
      sizing.ownerIs(
        owned.blocks?.find((entry) => entry.block_id === pane.blockId)?.owner ??
          null,
      );
    }

    const { ticket } = await control.call(
      "data.connect",
      {
        ...block,
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
    const stream = await relay({ control, data, hello });
    return {
      ...stream,
      id: randomUUID(),
      sessionLabel: options.label,
      fitsPanel: sizing.mayClaim,
      input: (events) => deliver(control, block, sizing, events),
    };
  } catch (error) {
    control.close();
    throw error;
  }
}

/** Asks Rex to resize the terminal. A refusal is not worth ending the pane. */
async function requestSize(
  control: RexControl,
  block: { session_id: string; block_id: string },
  size: GridSize,
): Promise<void> {
  await control
    .call(
      "com.superlogical.terminal.resize",
      {
        ...block,
        args: {
          columns: size.cols,
          rows: size.rows,
          cell_width_px: size.cellWidthPx,
          cell_height_px: size.cellHeightPx,
        },
      },
      z.unknown(),
    )
    .catch(() => {});
}

/**
 * Sends a batch of input to the block. Every `block.event` is written to the
 * control connection before any answer is awaited, in the batch's order, and
 * Rex runs them in the order they arrive.
 */
async function deliver(
  control: RexControl,
  block: { session_id: string; block_id: string },
  sizing: PaneSizing,
  events: readonly PaneInput[],
): Promise<void> {
  const sent: Promise<unknown>[] = [];
  for (const event of events) {
    if (event.type === "resize") {
      sizing.want(event.size);
      continue;
    }
    sent.push(
      control.call(
        "block.event",
        { ...block, event: blockEventFor(event) },
        z.unknown(),
      ),
    );
  }
  const refused = (await Promise.allSettled(sent)).find(
    (result) => result.status === "rejected",
  );
  if (refused !== undefined) throw refused.reason;
}

/** Completes the data handshake, then passes every stream byte to `body`. */
export function relay(options: {
  control: RexControl;
  data: WebSocket;
  hello: Uint8Array;
}): Promise<Relay> {
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
