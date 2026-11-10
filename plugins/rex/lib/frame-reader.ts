// Reads what a terminal shows, through libghostty-vt's render state: the
// viewport's rows of cells and the cursor. The viewport is wherever the
// terminal is scrolled to, so only the rows on screen are ever read, however
// long the history is.
//
// A cell's color is read as the program set it, not resolved to RGB. The
// default colors and the 16 ANSI colors stay symbolic, because the tab draws
// those from the app's theme. Only a palette color from 16 up is looked up in
// the terminal's palette here.
//
// It reads every cell on every call. That is slow for a renderer and plenty
// for one pane; `ghostty_render_state_row_get` has a bulk form to move to.

import { ansiColor, buildRuns, type Cell, type Run } from "./runs.ts";
import { RESULT, type Wasm } from "./wasm.ts";

// GhosttyRenderStateData.
const STATE_COLS = 1;
const STATE_ROWS = 2;
const STATE_ROW_ITERATOR = 4;
const STATE_CURSOR = 18;
const STATE_COLORS = 19;
// GhosttyRenderStateRowData.
const ROW_CELLS = 3;
// GhosttyRenderStateRowCellsData.
const CELL_RAW = 1;
const CELL_STYLE = 2;
const CELL_GRAPHEMES_UTF8 = 9;
// GhosttyCellData, GhosttyCellWide and GhosttyCellContentTag.
const RAW_CONTENT_TAG = 2;
const RAW_WIDE = 3;
const RAW_COLOR_PALETTE = 10;
const RAW_COLOR_RGB = 11;
const WIDE_WIDE = 1;
const WIDE_SPACER_TAIL = 2;
const CONTENT_BG_COLOR_PALETTE = 2;
const CONTENT_BG_COLOR_RGB = 3;
// GhosttyStyleColorTag.
const COLOR_PALETTE = 1;
const COLOR_RGB = 2;

// Struct sizes and field offsets, from `ghostty_type_json()`.
const COLORS_BYTES = 784; // GhosttyRenderStateColors
const COLORS_PALETTE = 14;
const CURSOR_BYTES = 20; // GhosttyRenderStateCursor
const CURSOR_VIEWPORT_HAS_VALUE = 4;
const CURSOR_VIEWPORT_X = 6;
const CURSOR_VIEWPORT_Y = 8;
const CURSOR_WIDE_TAIL = 10;
const CURSOR_VISIBLE = 11;
const CURSOR_VISUAL_STYLE = 16;
const STYLE_BYTES = 16; // GhosttyStyle
const STYLE_FG_COLOR = 0; // GhosttyStyleColor: a tag byte, then three of value
const STYLE_BG_COLOR = 4;
const STYLE_FLAGS = 12;
const BUFFER_BYTES = 12; // GhosttyBuffer: ptr, cap, len
const TEXT_BYTES = 64;
const OUT_BYTES = 24; // Room for a GhosttyTerminalScrollbar: three u64s.
const SCROLLBAR_OFFSET = 8;
// GhosttyTerminalData and GhosttyTerminalScreen.
const TERMINAL_ACTIVE_SCREEN = 6;
const TERMINAL_SCROLLBAR = 9;
const TERMINAL_MOUSE_TRACKING = 11;
const SCREEN_ALTERNATE = 1;

const CURSOR_STYLES = ["bar", "block", "underline", "hollow"] as const;

export type CursorStyle = (typeof CURSOR_STYLES)[number];

export interface Frame {
  cols: number;
  rows: number;
  /** Null when the cursor is hidden or outside the viewport. */
  cursor: { x: number; y: number; cols: 1 | 2; style: CursorStyle } | null;
  /** One entry per row, top to bottom. */
  lines: Run[][];
  /**
   * Where the viewport is among all the terminal's rows, history included:
   * `total` rows exist and the one at `offset` is the first shown. On the
   * live screen `offset` is `total - rows`. The alternate screen has no
   * history, so there `total` is `rows`.
   */
  scroll: { total: number; offset: number };
  /** Whether a full-screen program has switched to the alternate screen. */
  alternateScreen: boolean;
  /** Whether the program has asked to be sent mouse events. */
  mouseTracking: boolean;
}

export class FrameReader {
  readonly #wasm: Wasm;
  readonly #terminal: number;
  readonly #state: number;
  readonly #iterator: number;
  readonly #cells: number;
  // One allocation, carved into the out-parameters every read reuses.
  readonly #out: number;
  readonly #colors: number;
  readonly #cursor: number;
  readonly #style: number;
  readonly #buffer: number;
  readonly #text: number;

  constructor(wasm: Wasm, terminal: number) {
    this.#wasm = wasm;
    this.#terminal = terminal;
    this.#state = wasm.newHandle("create the render state", (slot) =>
      wasm.call("ghostty_render_state_new", 0, slot),
    );
    this.#iterator = wasm.newHandle("create the row iterator", (slot) =>
      wasm.call("ghostty_render_state_row_iterator_new", 0, slot),
    );
    this.#cells = wasm.newHandle("create the row cells", (slot) =>
      wasm.call("ghostty_render_state_row_cells_new", 0, slot),
    );
    this.#out = wasm.alloc(
      OUT_BYTES +
        COLORS_BYTES +
        CURSOR_BYTES +
        STYLE_BYTES +
        BUFFER_BYTES +
        TEXT_BYTES,
    );
    this.#colors = this.#out + OUT_BYTES;
    this.#cursor = this.#colors + COLORS_BYTES;
    this.#style = this.#cursor + CURSOR_BYTES;
    this.#buffer = this.#style + STYLE_BYTES;
    this.#text = this.#buffer + BUFFER_BYTES;
  }

  /** Reads the terminal's viewport as it is now. */
  read(): Frame {
    const wasm = this.#wasm;
    const state = this.#state;
    wasm.check("ghostty_render_state_update", state, this.#terminal);

    wasm.check("ghostty_render_state_get", state, STATE_COLS, this.#out);
    const cols = wasm.view.getUint16(this.#out, true);
    wasm.check("ghostty_render_state_get", state, STATE_ROWS, this.#out);
    const rows = wasm.view.getUint16(this.#out, true);

    // Sized structs carry their own size in their first field. This one is
    // read for its palette, which cells with a palette color index into.
    wasm.view.setUint32(this.#colors, COLORS_BYTES, true);
    wasm.check("ghostty_render_state_get", state, STATE_COLORS, this.#colors);

    // The iterator and the cells are filled through a pointer to their handle.
    wasm.view.setUint32(this.#out, this.#iterator, true);
    wasm.check(
      "ghostty_render_state_get",
      state,
      STATE_ROW_ITERATOR,
      this.#out,
    );
    const lines: Run[][] = [];
    while (
      wasm.call("ghostty_render_state_row_iterator_next", this.#iterator) !== 0
    ) {
      lines.push(buildRuns(this.#readRow()));
    }

    return {
      cols,
      rows,
      cursor: this.#readCursor(),
      lines,
      ...this.readScroll(),
    };
  }

  /** Reads only where the viewport is, without reading what it shows. */
  readScroll(): Pick<Frame, "scroll" | "alternateScreen" | "mouseTracking"> {
    const wasm = this.#wasm;
    const terminal = this.#terminal;
    wasm.check("ghostty_terminal_get", terminal, TERMINAL_SCROLLBAR, this.#out);
    const scroll = {
      total: Number(wasm.view.getBigUint64(this.#out, true)),
      offset: Number(
        wasm.view.getBigUint64(this.#out + SCROLLBAR_OFFSET, true),
      ),
    };
    wasm.check(
      "ghostty_terminal_get",
      terminal,
      TERMINAL_ACTIVE_SCREEN,
      this.#out,
    );
    const alternateScreen =
      wasm.view.getInt32(this.#out, true) === SCREEN_ALTERNATE;
    wasm.check(
      "ghostty_terminal_get",
      terminal,
      TERMINAL_MOUSE_TRACKING,
      this.#out,
    );
    return {
      scroll,
      alternateScreen,
      mouseTracking: wasm.bytes[this.#out] !== 0,
    };
  }

  #readCursor(): Frame["cursor"] {
    const wasm = this.#wasm;
    const cursor = this.#cursor;
    wasm.view.setUint32(cursor, CURSOR_BYTES, true);
    wasm.check("ghostty_render_state_get", this.#state, STATE_CURSOR, cursor);
    const bytes = wasm.bytes;
    if (
      bytes[cursor + CURSOR_VISIBLE] === 0 ||
      bytes[cursor + CURSOR_VIEWPORT_HAS_VALUE] === 0
    ) {
      return null;
    }
    const x = wasm.view.getUint16(cursor + CURSOR_VIEWPORT_X, true);
    const onWideTail = bytes[cursor + CURSOR_WIDE_TAIL] !== 0;
    const style = wasm.view.getInt32(cursor + CURSOR_VISUAL_STYLE, true);
    return {
      x: onWideTail ? x - 1 : x,
      y: wasm.view.getUint16(cursor + CURSOR_VIEWPORT_Y, true),
      cols: onWideTail ? 2 : 1,
      style: CURSOR_STYLES[style] ?? "block",
    };
  }

  #readRow(): Cell[] {
    const wasm = this.#wasm;
    const cells = this.#cells;
    wasm.view.setUint32(this.#out, cells, true);
    wasm.check(
      "ghostty_render_state_row_get",
      this.#iterator,
      ROW_CELLS,
      this.#out,
    );
    const row: Cell[] = [];
    while (wasm.call("ghostty_render_state_row_cells_next", cells) !== 0) {
      wasm.check(
        "ghostty_render_state_row_cells_get",
        cells,
        CELL_RAW,
        this.#out,
      );
      const raw = wasm.view.getBigUint64(this.#out, true);
      wasm.check("ghostty_cell_get", raw, RAW_WIDE, this.#out);
      const wide = wasm.view.getInt32(this.#out, true);
      if (wide === WIDE_SPACER_TAIL) {
        row.push({ text: "", width: 0, fg: null, bg: null, flags: 0 });
        continue;
      }
      wasm.check(
        "ghostty_render_state_row_cells_get",
        cells,
        CELL_STYLE,
        this.#style,
      );
      row.push({
        text: this.#readText(),
        width: wide === WIDE_WIDE ? 2 : 1,
        fg: this.#styleColor(STYLE_FG_COLOR),
        bg: this.#contentBackground(raw) ?? this.#styleColor(STYLE_BG_COLOR),
        flags: wasm.view.getUint16(this.#style + STYLE_FLAGS, true),
      });
    }
    return row;
  }

  /** A color of the current cell's style, or null for the default. */
  #styleColor(offset: number): number | null {
    const bytes = this.#wasm.bytes;
    const color = this.#style + offset;
    const tag = bytes[color];
    if (tag === COLOR_PALETTE) return this.#paletteColor(bytes[color + 1] ?? 0);
    return tag === COLOR_RGB ? readRgb(bytes, color + 1) : null;
  }

  /**
   * The background a cell with no text carries in the cell itself, as an
   * erased cell does, or null when it has none there.
   */
  #contentBackground(raw: bigint): number | null {
    const wasm = this.#wasm;
    wasm.check("ghostty_cell_get", raw, RAW_CONTENT_TAG, this.#out);
    const tag = wasm.view.getInt32(this.#out, true);
    if (tag === CONTENT_BG_COLOR_PALETTE) {
      wasm.check("ghostty_cell_get", raw, RAW_COLOR_PALETTE, this.#out);
      return this.#paletteColor(wasm.bytes[this.#out] ?? 0);
    }
    if (tag === CONTENT_BG_COLOR_RGB) {
      wasm.check("ghostty_cell_get", raw, RAW_COLOR_RGB, this.#out);
      return readRgb(wasm.bytes, this.#out);
    }
    return null;
  }

  /** The first 16 palette colors belong to the app's theme; the rest are RGB. */
  #paletteColor(index: number): number {
    if (index < 16) return ansiColor(index);
    return readRgb(this.#wasm.bytes, this.#colors + COLORS_PALETTE + index * 3);
  }

  /** The current cell's grapheme as a string, or "" for a cell with no text. */
  #readText(): string {
    const wasm = this.#wasm;
    const read = (pointer: number, capacity: number) => {
      wasm.view.setUint32(this.#buffer, pointer, true);
      wasm.view.setUint32(this.#buffer + 4, capacity, true);
      wasm.view.setUint32(this.#buffer + 8, 0, true);
      const result = wasm.call(
        "ghostty_render_state_row_cells_get",
        this.#cells,
        CELL_GRAPHEMES_UTF8,
        this.#buffer,
      );
      return { result, length: wasm.view.getUint32(this.#buffer + 8, true) };
    };
    const decode = (pointer: number, length: number) =>
      new TextDecoder().decode(wasm.bytes.subarray(pointer, pointer + length));

    const first = read(this.#text, TEXT_BYTES);
    if (first.result === RESULT.success) {
      if (first.length === 0) return "";
      if (first.length === 1) {
        return String.fromCharCode(wasm.bytes[this.#text] ?? 0x20);
      }
      return decode(this.#text, first.length);
    }
    if (first.result !== RESULT.outOfSpace) return "";
    // A long grapheme: the call left the size it needs in the buffer's length.
    const large = wasm.alloc(first.length);
    try {
      const second = read(large, first.length);
      return second.result === RESULT.success
        ? decode(large, second.length)
        : "";
    } finally {
      wasm.free(large, first.length);
    }
  }
}

function readRgb(bytes: Uint8Array, pointer: number): number {
  return (
    ((bytes[pointer] ?? 0) << 16) |
    ((bytes[pointer + 1] ?? 0) << 8) |
    (bytes[pointer + 2] ?? 0)
  );
}
