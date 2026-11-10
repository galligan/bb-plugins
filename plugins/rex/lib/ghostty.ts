// The parts of libghostty-vt this plugin uses, over the vendored
// `ghostty-vt.wasm`: restore a terminal from a snapshot, apply output to it,
// scroll it, and read back what to draw.
//
// Enum values and struct layouts are those of the pinned build recorded in
// ghostty-build.ts. They come from `include/ghostty/vt/*.h` in that build's
// source archive and from the module's own `ghostty_type_json()`.

import { FrameReader } from "./frame-reader.ts";
import { SnapshotHistory } from "./snapshot-history.ts";
import { Wasm } from "./wasm.ts";

// GhosttyTerminalOption and GhosttyTerminalData.
const OPT_SCROLLBACK_MAX_BYTES = 28;
const OPT_SCROLLBACK_MAX_LINES = 29;
const DATA_SCROLLBACK_ROWS = 15;
// GhosttyTerminalScrollViewportTag.
const SCROLL_BOTTOM = 1;
const SCROLL_DELTA = 2;
const SCROLL_ROW = 3;
// GhosttyTerminalScrollViewport: a tag, then its value 8 bytes in.
const SCROLL_VIEWPORT_BYTES = 24;
const SCROLL_VIEWPORT_VALUE = 8;
/** `size_t` is 32 bits in the module, and this is its largest value. */
const SIZE_BYTES = 4;
const SIZE_MAX = 0xffffffff;

/** A handle to a terminal inside the module. */
export type Terminal = number;

/** Where to move a terminal's viewport. */
export type ScrollTo =
  /** Back to the live screen. */
  | { kind: "bottom" }
  /** By a number of rows: negative is back into history. */
  | { kind: "rows"; rows: number }
  /** So that this row is the first one shown. Row 0 is the oldest kept. */
  | { kind: "row"; row: number };

export class GhosttyVt {
  readonly #wasm: Wasm;

  /**
   * Each pane gets its own instance. Terminals and readers are never freed
   * one by one: dropping the instance releases its whole memory.
   */
  static async instantiate(module: WebAssembly.Module): Promise<GhosttyVt> {
    return new GhosttyVt(new Wasm(await WebAssembly.instantiate(module, {})));
  }

  private constructor(wasm: Wasm) {
    this.#wasm = wasm;
  }

  /** The library's version string, such as `1.1.0-dev+f28124c`. */
  version(): string {
    const start = this.#wasm.call("ghostty_version");
    const bytes = this.#wasm.bytes;
    return new TextDecoder().decode(
      bytes.subarray(start, bytes.indexOf(0, start)),
    );
  }

  /**
   * Restores a terminal's screen from one complete snapshot, and returns it
   * with the snapshot's history, which is restored later, a page at a time.
   * The terminal keeps at most `maxHistoryRows` rows of history, whether
   * they come from the snapshot or from output afterwards.
   *
   * The decoder reports a snapshot of the wrong format version, a truncated
   * one, and a corrupt one with the same result, so check the envelope with
   * `findSnapshotEnd` first.
   */
  openSnapshot(
    snapshot: Uint8Array,
    maxHistoryRows: number,
  ): { terminal: Terminal; history: SnapshotHistory } {
    const wasm = this.#wasm;
    const source = wasm.alloc(snapshot.length);
    let decoder = 0;
    try {
      wasm.bytes.set(snapshot, source);
      decoder = wasm.newHandle("create the snapshot decoder", (slot) =>
        wasm.call(
          "ghostty_snapshot_decoder_new_buf",
          0,
          slot,
          source,
          snapshot.length,
        ),
      );
      const terminal = wasm.newHandle("decode the snapshot", (slot) =>
        wasm.call("ghostty_snapshot_decoder_ready", decoder, slot),
      );
      // Set before any history page, so a page that would go over the limit
      // is refused instead of restored and then dropped. Rows are the only
      // limit: the terminal arrives with its server's limit in bytes, which
      // restored history, held uncompressed here, would reach about a tenth
      // short of the rows the snapshot has.
      this.#setSize(terminal, OPT_SCROLLBACK_MAX_LINES, maxHistoryRows);
      this.#setSize(terminal, OPT_SCROLLBACK_MAX_BYTES, SIZE_MAX);
      return {
        terminal,
        history: new SnapshotHistory(wasm, {
          decoder,
          source,
          sourceBytes: snapshot.length,
          terminal,
          maxRows: maxHistoryRows,
        }),
      };
    } catch (error) {
      if (decoder !== 0) wasm.call("ghostty_snapshot_decoder_free", decoder);
      wasm.free(source, snapshot.length);
      throw error;
    }
  }

  /** Sets one `size_t` terminal option. */
  #setSize(terminal: Terminal, option: number, value: number): void {
    const wasm = this.#wasm;
    const pointer = wasm.alloc(SIZE_BYTES);
    try {
      wasm.view.setUint32(pointer, value, true);
      wasm.check("ghostty_terminal_set", terminal, option, pointer);
    } finally {
      wasm.free(pointer, SIZE_BYTES);
    }
  }

  /** How many rows of history the terminal holds above its screen. */
  historyRows(terminal: Terminal): number {
    const wasm = this.#wasm;
    const out = wasm.alloc(SIZE_BYTES);
    try {
      wasm.check("ghostty_terminal_get", terminal, DATA_SCROLLBACK_ROWS, out);
      return wasm.view.getUint32(out, true);
    } finally {
      wasm.free(out, SIZE_BYTES);
    }
  }

  /**
   * Moves the terminal's viewport through its scrollback. This is local to
   * this terminal: nothing is sent anywhere. The move is clamped to the rows
   * that exist, and does nothing on the alternate screen, which has no
   * history.
   */
  scrollViewport(terminal: Terminal, to: ScrollTo): void {
    const wasm = this.#wasm;
    const behavior = wasm.alloc(SCROLL_VIEWPORT_BYTES);
    try {
      wasm.bytes.fill(0, behavior, behavior + SCROLL_VIEWPORT_BYTES);
      const view = wasm.view;
      if (to.kind === "bottom") {
        view.setInt32(behavior, SCROLL_BOTTOM, true);
      } else if (to.kind === "rows") {
        view.setInt32(behavior, SCROLL_DELTA, true);
        view.setInt32(behavior + SCROLL_VIEWPORT_VALUE, to.rows, true);
      } else {
        view.setInt32(behavior, SCROLL_ROW, true);
        view.setUint32(behavior + SCROLL_VIEWPORT_VALUE, to.row, true);
      }
      wasm.check("ghostty_terminal_scroll_viewport", terminal, behavior);
    } finally {
      wasm.free(behavior, SCROLL_VIEWPORT_BYTES);
    }
  }

  /** Applies terminal output to the terminal. */
  write(terminal: Terminal, data: Uint8Array): void {
    if (data.length === 0) return;
    const wasm = this.#wasm;
    const pointer = wasm.alloc(data.length);
    wasm.bytes.set(data, pointer);
    wasm.call("ghostty_terminal_vt_write", terminal, pointer, data.length);
    wasm.free(pointer, data.length);
  }

  resize(
    terminal: Terminal,
    size: {
      cols: number;
      rows: number;
      cellWidthPx: number;
      cellHeightPx: number;
    },
  ): void {
    this.#wasm.check(
      "ghostty_terminal_resize",
      terminal,
      size.cols,
      size.rows,
      size.cellWidthPx,
      size.cellHeightPx,
    );
  }

  /** Makes a reader for what the terminal shows. */
  newFrameReader(terminal: Terminal): FrameReader {
    return new FrameReader(this.#wasm, terminal);
  }

  /**
   * Makes an empty terminal that keeps all of its history. Tests use it to
   * build a snapshot without Rex.
   */
  newTerminal(cols: number, rows: number): Terminal {
    const wasm = this.#wasm;
    const terminal = wasm.newHandle("create a terminal", (slot) =>
      wasm.call("ghostty_terminal_new", 0, slot, cols, rows),
    );
    // A new terminal keeps about one page of history unless told otherwise.
    this.#setSize(terminal, OPT_SCROLLBACK_MAX_BYTES, SIZE_MAX);
    return terminal;
  }

  /** Encodes the terminal as a snapshot, as a Rex server does for a stream. */
  encodeSnapshot(terminal: Terminal): Uint8Array {
    const wasm = this.#wasm;
    const out = wasm.alloc(8); // uint8_t*, then size_t.
    try {
      wasm.check("ghostty_snapshot_encode_alloc", terminal, 0, out, out + 4);
      const pointer = wasm.view.getUint32(out, true);
      const length = wasm.view.getUint32(out + 4, true);
      const snapshot = wasm.bytes.slice(pointer, pointer + length);
      wasm.call("ghostty_free", 0, pointer, length);
      return snapshot;
    } finally {
      wasm.free(out, 8);
    }
  }
}
