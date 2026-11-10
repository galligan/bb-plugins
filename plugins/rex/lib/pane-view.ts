// What the tab shows of a terminal, and how its view moves through history
// that is only partly restored.
//
// The view counts rows as if the whole history were there. Rows the snapshot
// has not given up yet sit above the ones the terminal holds, so the
// scrollbar is the right length from the start and does not grow as pages
// arrive. Before the view moves, enough older pages are restored that the top
// of what the terminal holds stays well out of sight while more exists.

import type { Frame, FrameReader } from "./frame-reader.ts";
import type { GhosttyVt, ScrollTo, Terminal } from "./ghostty.ts";
import type { SnapshotHistory } from "./snapshot-history.ts";

/**
 * How many restored rows are kept above the view while older ones wait. A
 * view that reached the first restored row would stay on the first row as
 * pages arrived above it, so it is never allowed to get there.
 */
export const RESTORE_AHEAD_ROWS = 1_000;

export class PaneView {
  readonly #vt: GhosttyVt;
  readonly #terminal: Terminal;
  readonly #history: SnapshotHistory;
  readonly #reader: FrameReader;

  constructor(vt: GhosttyVt, terminal: Terminal, history: SnapshotHistory) {
    this.#vt = vt;
    this.#terminal = terminal;
    this.#history = history;
    this.#reader = vt.newFrameReader(terminal);
  }

  /** Whether all the history the terminal will get has been restored. */
  get historyRestored(): boolean {
    return this.#history.finished;
  }

  /** Reads what the terminal shows, placed among all of its history. */
  read(): Frame {
    this.#history.finishIfNearlyFull();
    const frame = this.#reader.read();
    // The alternate screen has no history, restored or not.
    const pending = frame.alternateScreen ? 0 : this.#history.pendingRows;
    if (pending === 0) return frame;
    return {
      ...frame,
      scroll: {
        total: frame.scroll.total + pending,
        offset: frame.scroll.offset + pending,
      },
    };
  }

  /**
   * Moves the view. Rows are counted as `read` reports them. This is local
   * to this terminal: nothing is sent anywhere.
   */
  scroll(to: ScrollTo): void {
    const vt = this.#vt;
    const terminal = this.#terminal;
    if (to.kind === "bottom" || this.#reader.readScroll().alternateScreen) {
      vt.scrollViewport(terminal, to);
      return;
    }
    if (to.kind === "rows") {
      if (to.rows < 0) {
        this.#restoreUntil(
          () =>
            this.#reader.readScroll().scroll.offset + to.rows >=
            RESTORE_AHEAD_ROWS,
        );
      }
      vt.scrollViewport(terminal, to);
      return;
    }
    this.#restoreUntil(
      () => to.row - this.#history.pendingRows >= RESTORE_AHEAD_ROWS,
    );
    vt.scrollViewport(terminal, {
      kind: "row",
      row: Math.max(0, to.row - this.#history.pendingRows),
    });
  }

  /** Restores older pages until `enough` says so or there are no more. */
  #restoreUntil(enough: () => boolean): void {
    while (!enough() && this.#history.restorePage()) {
      // Each page moves the rows the terminal holds further from its top.
    }
  }
}
