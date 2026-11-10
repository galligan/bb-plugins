// The history a snapshot carries, restored a page at a time.
//
// libghostty restores a snapshot's screen first. The history above it comes
// afterwards in pages of a few hundred rows, newest first, and the terminal
// can be drawn, scrolled, resized and written to between pages. So the tab
// shows the screen at once and restores older pages only when the view gets
// near them: a terminal nobody scrolls back never pays for its history.
//
// The decoder reads from the snapshot's bytes for as long as pages remain, so
// both are kept in the module's memory until the last page is restored or the
// terminal is full, and freed then.

import type { Terminal } from "./ghostty.ts";
import { RESULT, type Wasm } from "./wasm.ts";

// GhosttySnapshotDecoderData and GhosttySnapshotDecoderProgressKind.
const DATA_HISTORY_ROWS_PRIMARY = 3;
const DATA_PROGRESS_ROWS = 6;
const DATA_PROGRESS_KIND = 11;
const PROGRESS_KIND_PAGE = 0;
// GhosttyTerminalData.
const TERMINAL_SCROLLBACK_ROWS = 15;
/** Room for the widest value read here, a `uint64_t`. */
const OUT_BYTES = 8;
/** With less room than this, whether another page fits is found by trying. */
const NEARLY_FULL_ROWS = 1_000;

/**
 * How many rows of history are still to come: what the snapshot has left,
 * but no more than the terminal has room for.
 */
export function pendingRows(history: {
  /** Rows the snapshot has not given up yet. */
  remaining: number;
  /** Rows of history the terminal holds now. */
  held: number;
  /** The most rows of history the terminal keeps. */
  maxRows: number;
}): number {
  const room = Math.max(0, history.maxRows - history.held);
  return Math.max(0, Math.min(history.remaining, room));
}

export class SnapshotHistory {
  readonly #wasm: Wasm;
  readonly #terminal: Terminal;
  readonly #maxRows: number;
  readonly #out: number;
  /** The decoder and the snapshot bytes it reads, until both are freed. */
  #open: { decoder: number; source: number; sourceBytes: number } | null;
  #remaining: number;

  /**
   * `decoder` has restored `terminal`'s screen and reads from the
   * `sourceBytes` bytes at `source`. This takes ownership of both.
   */
  constructor(
    wasm: Wasm,
    snapshot: {
      decoder: number;
      source: number;
      sourceBytes: number;
      terminal: Terminal;
      maxRows: number;
    },
  ) {
    this.#wasm = wasm;
    this.#terminal = snapshot.terminal;
    this.#maxRows = snapshot.maxRows;
    this.#open = snapshot;
    this.#out = wasm.alloc(OUT_BYTES);
    // The decoder knows how much history the snapshot has from the start,
    // counting the rows that came with the screen. A build that could not
    // say would leave this at 0, and the history would seem to grow as pages
    // arrive.
    const declared =
      wasm.call(
        "ghostty_snapshot_decoder_get",
        snapshot.decoder,
        DATA_HISTORY_ROWS_PRIMARY,
        this.#out,
      ) === RESULT.success
        ? Number(wasm.view.getBigUint64(this.#out, true))
        : 0;
    this.#remaining = Math.max(0, declared - this.#held());
  }

  /** Whether everything this will ever restore has been restored. */
  get finished(): boolean {
    return this.#open === null;
  }

  /** Rows of history still to restore. An estimate until `finished`. */
  get pendingRows(): number {
    if (this.#open === null) return 0;
    return pendingRows({
      remaining: this.#remaining,
      held: this.#held(),
      maxRows: this.#maxRows,
    });
  }

  /**
   * Restores the next page above the history the terminal holds. Returns
   * false, having freed the snapshot, when there was nothing more to restore
   * or the terminal would not take it.
   */
  restorePage(): boolean {
    const wasm = this.#wasm;
    for (;;) {
      if (this.#open === null) return false;
      const { decoder } = this.#open;
      const result = wasm.call("ghostty_snapshot_decoder_next", decoder);
      if (result !== RESULT.success) {
        // The end of the snapshot, or a page that does not decode. Either
        // way the terminal keeps the history it has and this is over.
        this.#release();
        return false;
      }
      // Pixels of an image can come between pages. They add no rows.
      wasm.check(
        "ghostty_snapshot_decoder_get",
        decoder,
        DATA_PROGRESS_KIND,
        this.#out,
      );
      if (wasm.view.getInt32(this.#out, true) !== PROGRESS_KIND_PAGE) continue;
      wasm.check(
        "ghostty_snapshot_decoder_get",
        decoder,
        DATA_PROGRESS_ROWS,
        this.#out,
      );
      const rows = wasm.view.getUint32(this.#out, true);
      if (rows === 0) {
        // The terminal refused the page: it is full, or its history was
        // cleared since. Older pages would be refused too.
        this.#release();
        return false;
      }
      this.#remaining = Math.max(0, this.#remaining - rows);
      return true;
    }
  }

  /**
   * Finishes early when the terminal is nearly full, which output arriving
   * after the snapshot brings about on its own: restores the pages that still
   * fit, then frees the snapshot.
   */
  finishIfNearlyFull(): void {
    if (this.#open === null) return;
    if (this.#maxRows - this.#held() >= NEARLY_FULL_ROWS) return;
    while (this.restorePage()) {
      // Until the terminal refuses one.
    }
  }

  /**
   * Rows of history the terminal holds. While a full-screen program shows,
   * this is that screen's history, which is none.
   */
  #held(): number {
    const wasm = this.#wasm;
    wasm.check(
      "ghostty_terminal_get",
      this.#terminal,
      TERMINAL_SCROLLBACK_ROWS,
      this.#out,
    );
    return wasm.view.getUint32(this.#out, true);
  }

  #release(): void {
    if (this.#open === null) return;
    const { decoder, source, sourceBytes } = this.#open;
    this.#open = null;
    this.#remaining = 0;
    this.#wasm.call("ghostty_snapshot_decoder_free", decoder);
    this.#wasm.free(source, sourceBytes);
  }
}
