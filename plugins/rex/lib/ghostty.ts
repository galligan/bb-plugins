// The parts of libghostty-vt this plugin uses, over the vendored
// `ghostty-vt.wasm`: restore a terminal from a snapshot, apply output to it,
// and read back what to draw.
//
// Enum values and struct layouts are those of the pinned build recorded in
// ghostty-build.ts. They come from `include/ghostty/vt/*.h` in that build's
// source archive and from the module's own `ghostty_type_json()`.

import { FrameReader } from "./frame-reader.ts";
import type { Theme } from "./theme.ts";
import { Wasm } from "./wasm.ts";

// GhosttyTerminalOption.
const OPT_COLOR_FOREGROUND = 12;
const OPT_COLOR_BACKGROUND = 13;
const OPT_COLOR_CURSOR = 14;
const OPT_COLOR_PALETTE = 15;
// GhosttyTerminalData.
const DATA_COLOR_PALETTE_DEFAULT = 25;

const RGB_BYTES = 3;
const PALETTE_BYTES = 256 * RGB_BYTES;

/** A handle to a terminal inside the module. */
export type Terminal = number;

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
   * Restores a terminal from one complete snapshot.
   *
   * The decoder reports a snapshot of the wrong format version, a truncated
   * one, and a corrupt one with the same result, so check the envelope with
   * `findSnapshotEnd` first.
   */
  decodeSnapshot(snapshot: Uint8Array): Terminal {
    const wasm = this.#wasm;
    const source = wasm.alloc(snapshot.length);
    try {
      wasm.bytes.set(snapshot, source);
      const decoder = wasm.newHandle("create the snapshot decoder", (slot) =>
        wasm.call(
          "ghostty_snapshot_decoder_new_buf",
          0,
          slot,
          source,
          snapshot.length,
        ),
      );
      try {
        return wasm.newHandle("decode the snapshot", (slot) =>
          wasm.call("ghostty_snapshot_decoder_decode", decoder, slot),
        );
      } finally {
        wasm.call("ghostty_snapshot_decoder_free", decoder);
      }
    } finally {
      wasm.free(source, snapshot.length);
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

  /** Replaces the terminal's default colors. Null restores a built-in color. */
  applyTheme(terminal: Terminal, theme: Theme): void {
    const wasm = this.#wasm;
    const scratch = wasm.alloc(PALETTE_BYTES);
    try {
      const setColor = (option: number, color: number | null) => {
        if (color !== null) writeRgb(wasm.bytes, scratch, color);
        wasm.check(
          "ghostty_terminal_set",
          terminal,
          option,
          color === null ? 0 : scratch,
        );
      };
      setColor(OPT_COLOR_FOREGROUND, theme.foreground);
      setColor(OPT_COLOR_BACKGROUND, theme.background);
      setColor(OPT_COLOR_CURSOR, theme.cursor);

      // Each theme replaces the one before it, so start from the built-in
      // palette and apply only this theme's changes.
      wasm.check("ghostty_terminal_set", terminal, OPT_COLOR_PALETTE, 0);
      if (theme.palette.size === 0) return;
      wasm.check(
        "ghostty_terminal_get",
        terminal,
        DATA_COLOR_PALETTE_DEFAULT,
        scratch,
      );
      for (const [index, color] of theme.palette) {
        writeRgb(wasm.bytes, scratch + index * RGB_BYTES, color);
      }
      wasm.check("ghostty_terminal_set", terminal, OPT_COLOR_PALETTE, scratch);
    } finally {
      wasm.free(scratch, PALETTE_BYTES);
    }
  }

  /** Makes a reader for what the terminal shows. */
  newFrameReader(terminal: Terminal): FrameReader {
    return new FrameReader(this.#wasm, terminal);
  }

  /** Makes an empty terminal. Tests use it to build a snapshot without Rex. */
  newTerminal(cols: number, rows: number): Terminal {
    return this.#wasm.newHandle("create a terminal", (slot) =>
      this.#wasm.call("ghostty_terminal_new", 0, slot, cols, rows),
    );
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

function writeRgb(bytes: Uint8Array, pointer: number, color: number): void {
  bytes[pointer] = (color >> 16) & 0xff;
  bytes[pointer + 1] = (color >> 8) & 0xff;
  bytes[pointer + 2] = color & 0xff;
}
