// Applies a Rex terminal stream to a libghostty terminal.
//
// The stream opens with a snapshot, which libghostty needs whole before it
// restores the screen, so bytes are held until the snapshot's own framing says
// it is complete. Everything after it is terminal output with Rex's messages
// mixed in. The snapshot's history is restored later, as the view nears it.
//
// Rex's `theme` messages are skipped on purpose: the tab draws the terminal's
// default and ANSI colors from the app's theme, whoever owns the pane.

import type { GhosttyVt, Terminal } from "./ghostty.ts";
import { HistoryClearScan } from "./history-clear.ts";
import { PaneView } from "./pane-view.ts";
import { parseRexMessage, RexMessageSplitter } from "./rex-messages.ts";
import { findSnapshotEnd, newSnapshotScan } from "./snapshot.ts";

/**
 * The most rows of history the tab keeps, counting what a snapshot arrives
 * with and what builds up afterwards. Memory is the reason for a limit:
 * history costs most of a MiB for each 1,000 rows at 80 columns, and the
 * module's memory never shrinks once it has grown.
 */
export const MAX_HISTORY_ROWS = 100_000;

/** A snapshot grows with scrollback and images. Past this, give up. */
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export class PaneDecoder {
  readonly #vt: GhosttyVt;
  readonly #splitter: RexMessageSplitter;
  readonly #maxHistoryRows: number;
  readonly #scan = newSnapshotScan();
  readonly #clears = new HistoryClearScan();
  #pending = new Uint8Array(64 * 1024);
  #pendingLength = 0;
  #terminal: Terminal | null = null;
  #view: PaneView | null = null;
  #exit: { code: number | null } | null = null;

  constructor(vt: GhosttyVt, nonce: string, maxHistoryRows = MAX_HISTORY_ROWS) {
    this.#vt = vt;
    this.#splitter = new RexMessageSplitter(nonce);
    this.#maxHistoryRows = maxHistoryRows;
  }

  /** The terminal, once the snapshot has been decoded. */
  get terminal(): Terminal | null {
    return this.#terminal;
  }

  /** What to draw and how to scroll it, once the snapshot has been decoded. */
  get view(): PaneView | null {
    return this.#view;
  }

  /** Set once Rex reports that the terminal's program exited. */
  get exit(): { code: number | null } | null {
    return this.#exit;
  }

  /**
   * Applies the next bytes of the stream.
   *
   * Throws `SnapshotFormatError` when the snapshot is in a format this build
   * cannot decode, and `GhosttyError` when libghostty refuses it.
   */
  push(chunk: Uint8Array): void {
    if (this.#terminal !== null) {
      this.#applyLive(this.#terminal, chunk);
      return;
    }
    this.#hold(chunk);
    const received = this.#pending.subarray(0, this.#pendingLength);
    const end = findSnapshotEnd(received, this.#scan);
    if (end === null) return;
    const { terminal, history } = this.#vt.openSnapshot(
      received.subarray(0, end),
      this.#maxHistoryRows,
    );
    this.#terminal = terminal;
    this.#view = new PaneView(this.#vt, terminal, history);
    const live = received.slice(end);
    this.#pending = new Uint8Array(0);
    this.#applyLive(terminal, live);
  }

  #hold(chunk: Uint8Array): void {
    const needed = this.#pendingLength + chunk.length;
    if (needed > MAX_SNAPSHOT_BYTES) {
      throw new Error(
        `The terminal's snapshot is larger than ${MAX_SNAPSHOT_BYTES / (1024 * 1024)} MiB.`,
      );
    }
    if (needed > this.#pending.length) {
      const grown = new Uint8Array(Math.max(needed, this.#pending.length * 2));
      grown.set(this.#pending.subarray(0, this.#pendingLength));
      this.#pending = grown;
    }
    this.#pending.set(chunk, this.#pendingLength);
    this.#pendingLength = needed;
  }

  #applyLive(terminal: Terminal, bytes: Uint8Array): void {
    for (const part of this.#splitter.push(bytes)) {
      if (part.kind === "vt") {
        this.#vt.write(terminal, part.bytes);
        if (this.#clears.push(part.bytes)) this.#view?.historyCleared();
        continue;
      }
      const message = parseRexMessage(part.json);
      if (message.type === "resize") {
        this.#vt.resize(terminal, {
          cols: message.cols,
          rows: message.rows,
          cellWidthPx: message.cell_width_px ?? 0,
          cellHeightPx: message.cell_height_px ?? 0,
        });
      } else if (message.type === "child_exited") {
        this.#exit = { code: message.exit_code ?? null };
      }
    }
  }
}
