// Reads what a terminal shows, through libghostty-vt's render state: the
// viewport's rows of cells, the default colors, and the cursor.
//
// It reads every cell on every call. That is slow for a renderer and plenty
// for one pane; `ghostty_render_state_row_get` has a bulk form to move to.

import { buildRuns, type Cell, type Run } from "./runs.ts";
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
const CELL_BG_COLOR = 5;
const CELL_FG_COLOR = 6;
const CELL_GRAPHEMES_UTF8 = 9;
// GhosttyCellData and GhosttyCellWide.
const RAW_WIDE = 3;
const WIDE_WIDE = 1;
const WIDE_SPACER_TAIL = 2;

// Struct sizes and field offsets, from `ghostty_type_json()`.
const COLORS_BYTES = 784; // GhosttyRenderStateColors
const COLORS_BACKGROUND = 4;
const COLORS_FOREGROUND = 7;
const COLORS_CURSOR = 10;
const COLORS_CURSOR_HAS_VALUE = 13;
const CURSOR_BYTES = 20; // GhosttyRenderStateCursor
const CURSOR_VIEWPORT_HAS_VALUE = 4;
const CURSOR_VIEWPORT_X = 6;
const CURSOR_VIEWPORT_Y = 8;
const CURSOR_WIDE_TAIL = 10;
const CURSOR_VISIBLE = 11;
const CURSOR_VISUAL_STYLE = 16;
const STYLE_BYTES = 16; // GhosttyStyle
const STYLE_FLAGS = 12;
const BUFFER_BYTES = 12; // GhosttyBuffer: ptr, cap, len
const TEXT_BYTES = 64;
const OUT_BYTES = 8;

const CURSOR_STYLES = ["bar", "block", "underline", "hollow"] as const;

export type CursorStyle = (typeof CURSOR_STYLES)[number];

export interface Frame {
  cols: number;
  rows: number;
  /** Default colors, packed 0xRRGGBB. */
  foreground: number;
  background: number;
  /** Null when the terminal sets no cursor color of its own. */
  cursorColor: number | null;
  /** Null when the cursor is hidden or outside the viewport. */
  cursor: { x: number; y: number; cols: 1 | 2; style: CursorStyle } | null;
  /** One entry per row, top to bottom. */
  lines: Run[][];
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

    // Sized structs carry their own size in their first field.
    wasm.view.setUint32(this.#colors, COLORS_BYTES, true);
    wasm.check("ghostty_render_state_get", state, STATE_COLORS, this.#colors);
    const colors = wasm.bytes;
    const foreground = readRgb(colors, this.#colors + COLORS_FOREGROUND);
    const background = readRgb(colors, this.#colors + COLORS_BACKGROUND);
    const cursorColor =
      colors[this.#colors + COLORS_CURSOR_HAS_VALUE] === 0
        ? null
        : readRgb(colors, this.#colors + COLORS_CURSOR);

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
      foreground,
      background,
      cursorColor,
      cursor: this.#readCursor(),
      lines,
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
        fg: this.#readCellColor(CELL_FG_COLOR),
        bg: this.#readCellColor(CELL_BG_COLOR),
        flags: wasm.view.getUint16(this.#style + STYLE_FLAGS, true),
      });
    }
    return row;
  }

  /** A cell's own color, or null when it uses the terminal's default. */
  #readCellColor(data: number): number | null {
    const wasm = this.#wasm;
    const result = wasm.call(
      "ghostty_render_state_row_cells_get",
      this.#cells,
      data,
      this.#out,
    );
    return result === RESULT.success ? readRgb(wasm.bytes, this.#out) : null;
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
