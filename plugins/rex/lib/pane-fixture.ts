// A pane to test against, restored by the vendored ghostty-vt.wasm from a
// snapshot the same build made, as a Rex server's are. No Rex is involved.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { Frame } from "./frame-reader.ts";
import { GhosttyVt, type ScrollTo } from "./ghostty.ts";
import { PaneDecoder } from "./pane-decoder.ts";

export const NONCE = "424242";
export const SIZE = { cols: 40, rows: 10 };

const wasmModule = await WebAssembly.compile(
  await readFile(new URL("../vendor/ghostty-vt.wasm", import.meta.url)),
);

const encode = (text: string) => new TextEncoder().encode(text);

/** `count` numbered lines, the first numbered `from`. */
export const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `line ${from + index}\r\n`).join(
    "",
  );

/**
 * A snapshot of a terminal that printed `count` numbered lines, and then
 * `after` if given.
 */
export async function snapshotWithLines(
  count: number,
  after = "",
): Promise<Uint8Array> {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const terminal = vt.newTerminal(SIZE.cols, SIZE.rows);
  // In pieces, so a long history does not need one enormous write.
  for (let from = 1; from <= count; from += 1000) {
    vt.write(terminal, encode(lines(Math.min(1000, count - from + 1), from)));
  }
  vt.write(terminal, encode(after));
  return vt.encodeSnapshot(terminal);
}

/** A pane restored from `snapshot`, with ways to feed, scroll and read it. */
export async function openPane(snapshot: Uint8Array, maxHistoryRows?: number) {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const decoder = new PaneDecoder(vt, NONCE, maxHistoryRows);
  decoder.push(snapshot);
  const { terminal, view } = decoder;
  assert.ok(terminal !== null && view !== null, "the snapshot was decoded");
  const text = (frame: Frame, row: number) =>
    (frame.lines[row] ?? []).map((run) => run.text).join("");
  return {
    view,
    read: () => view.read(),
    scroll: (to: ScrollTo) => view.scroll(to),
    feed: (output: string) => decoder.push(encode(output)),
    /** The text of the first row shown. */
    top: () => text(view.read(), 0),
    text,
    /** Rows of history the terminal itself holds, restored so far. */
    held: () => vt.historyRows(terminal),
  };
}

/** Rows of history above the screen, restored or not. */
export const history = (frame: Frame) => frame.scroll.total - frame.rows;
