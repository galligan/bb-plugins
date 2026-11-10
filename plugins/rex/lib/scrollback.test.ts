// Scrollback, against the vendored ghostty-vt.wasm. Snapshots with history are
// made by filling a terminal from the same build, as a Rex server's are.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { Frame } from "./frame-reader.ts";
import { GhosttyVt, type Terminal } from "./ghostty.ts";
import { PaneDecoder, SCROLLBACK_ROWS } from "./pane-decoder.ts";

const NONCE = "424242";
const SIZE = { cols: 40, rows: 10 };
const wasmModule = await WebAssembly.compile(
  await readFile(new URL("../vendor/ghostty-vt.wasm", import.meta.url)),
);

const encode = (text: string) => new TextEncoder().encode(text);
const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `line ${from + index}\r\n`).join(
    "",
  );

/** A snapshot of a terminal that printed `count` numbered lines. */
async function snapshotWithLines(count: number): Promise<Uint8Array> {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const terminal = vt.newTerminal(SIZE.cols, SIZE.rows);
  vt.write(terminal, encode(lines(count)));
  return vt.encodeSnapshot(terminal);
}

/** A pane restored from `snapshot`, with ways to feed, scroll and read it. */
async function open(snapshot: Uint8Array) {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const decoder = new PaneDecoder(vt, NONCE);
  decoder.push(snapshot);
  const terminal: Terminal = decoder.terminal ?? 0;
  assert.notEqual(terminal, 0, "the snapshot was decoded");
  const reader = vt.newFrameReader(terminal);
  const text = (frame: Frame, row: number) =>
    (frame.lines[row] ?? []).map((run) => run.text).join("");
  return {
    vt,
    terminal,
    read: () => reader.read(),
    feed: (output: string) => decoder.push(encode(output)),
    top: () => text(reader.read(), 0),
    text,
  };
}

/** Rows of history above the screen. */
const history = (frame: Frame) => frame.scroll.total - frame.rows;

test("a snapshot brings the terminal's earlier output with it", async () => {
  const pane = await open(await snapshotWithLines(300));
  const frame = pane.read();
  // 300 lines and the empty line the cursor is left on, less the screen.
  assert.equal(history(frame), 301 - SIZE.rows);
  assert.equal(
    frame.scroll.offset,
    history(frame),
    "it opens on the live screen",
  );
  assert.equal(pane.text(frame, SIZE.rows - 2), "line 300");

  pane.vt.scrollViewport(pane.terminal, { kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
});

test("keeps only the newest history when a snapshot has more than the limit", async () => {
  const printed = 3 * SCROLLBACK_ROWS;
  const pane = await open(await snapshotWithLines(printed));
  const frame = pane.read();
  // History is dropped a whole page at a time, so what is kept can be up to
  // one page short of the limit, and is never over it.
  assert.ok(
    history(frame) > SCROLLBACK_ROWS - 1000 &&
      history(frame) <= SCROLLBACK_ROWS,
    `kept ${history(frame)} rows`,
  );
  assert.equal(pane.text(frame, SIZE.rows - 2), `line ${printed}`);

  pane.vt.scrollViewport(pane.terminal, { kind: "row", row: 0 });
  const oldest = Number(pane.top().replace("line ", ""));
  assert.equal(oldest, printed + 1 - pane.read().scroll.total + 1);
});

test("holds the history to the limit as more output arrives", async () => {
  const pane = await open(await snapshotWithLines(100));
  pane.feed(lines(2 * SCROLLBACK_ROWS, 101));
  const kept = history(pane.read());
  assert.ok(
    kept > SCROLLBACK_ROWS - 1000 && kept <= SCROLLBACK_ROWS,
    `kept ${kept} rows`,
  );
});

test("scrolls back by rows, stops at the oldest row, and returns to the live screen", async () => {
  const pane = await open(await snapshotWithLines(100));
  const live = pane.read().scroll.offset;

  pane.vt.scrollViewport(pane.terminal, { kind: "rows", rows: -5 });
  let frame = pane.read();
  assert.equal(frame.scroll.offset, live - 5);
  assert.equal(pane.text(frame, 0), "line 87");
  assert.equal(frame.cursor, null, "the cursor is below the view");

  pane.vt.scrollViewport(pane.terminal, { kind: "rows", rows: 3 });
  assert.equal(pane.read().scroll.offset, live - 2);

  pane.vt.scrollViewport(pane.terminal, { kind: "rows", rows: -100_000 });
  assert.equal(pane.read().scroll.offset, 0);
  assert.equal(pane.top(), "line 1");

  pane.vt.scrollViewport(pane.terminal, { kind: "rows", rows: 100_000 });
  assert.equal(pane.read().scroll.offset, live);

  pane.vt.scrollViewport(pane.terminal, { kind: "row", row: 40 });
  assert.equal(pane.top(), "line 41");
  pane.vt.scrollViewport(pane.terminal, { kind: "bottom" });
  frame = pane.read();
  assert.equal(frame.scroll.offset, live);
  assert.notEqual(frame.cursor, null);
});

test("new output does not move a view that is scrolled back", async () => {
  const pane = await open(await snapshotWithLines(100));
  pane.vt.scrollViewport(pane.terminal, { kind: "row", row: 40 });
  const before = pane.read();

  pane.feed(lines(25, 101));
  const after = pane.read();
  assert.equal(after.scroll.offset, before.scroll.offset);
  assert.deepEqual(after.lines, before.lines);
  assert.equal(after.scroll.total, before.scroll.total + 25);
});

test("new output is followed while the view is on the live screen", async () => {
  const pane = await open(await snapshotWithLines(100));
  pane.feed(lines(25, 101));
  const frame = pane.read();
  assert.equal(frame.scroll.offset, history(frame));
  assert.equal(pane.text(frame, SIZE.rows - 2), "line 125");
});

test("a resize keeps the first row of a view that is scrolled back", async () => {
  const pane = await open(await snapshotWithLines(100));
  pane.vt.scrollViewport(pane.terminal, { kind: "row", row: 40 });
  const resize = (cols: number, rows: number) =>
    pane.feed(
      `\x1b_rex1;${NONCE};${JSON.stringify({ type: "resize", cols, rows })}\x1b\\`,
    );

  resize(SIZE.cols, 20);
  let frame = pane.read();
  assert.deepEqual([frame.rows, frame.scroll.offset], [20, 40]);
  assert.equal(pane.text(frame, 0), "line 41");

  resize(SIZE.cols, 6);
  frame = pane.read();
  assert.deepEqual([frame.rows, frame.scroll.offset], [6, 40]);
  assert.equal(pane.text(frame, 0), "line 41");

  // Narrower than before, with lines short enough not to wrap.
  resize(20, 6);
  assert.equal(pane.top(), "line 41");
});

test("the alternate screen has no history to scroll", async () => {
  const pane = await open(await snapshotWithLines(100));
  assert.equal(pane.read().alternateScreen, false);

  pane.feed("\x1b[?1049h\x1b[Hfull screen");
  let frame = pane.read();
  assert.equal(frame.alternateScreen, true);
  assert.deepEqual(frame.scroll, { total: SIZE.rows, offset: 0 });
  pane.vt.scrollViewport(pane.terminal, { kind: "rows", rows: -5 });
  assert.deepEqual(pane.read().scroll, { total: SIZE.rows, offset: 0 });
  assert.equal(pane.top(), "full screen");

  // Leaving it brings the history back, on the live screen.
  pane.feed("\x1b[?1049l");
  frame = pane.read();
  assert.equal(frame.alternateScreen, false);
  assert.equal(frame.scroll.offset, history(frame));
  assert.equal(history(frame), 301 - 200 - SIZE.rows);
});

test("reports when the program has asked for mouse events", async () => {
  const pane = await open(await snapshotWithLines(5));
  assert.equal(pane.read().mouseTracking, false);
  pane.feed("\x1b[?1000h");
  assert.equal(pane.read().mouseTracking, true);
  pane.feed("\x1b[?1000l");
  assert.equal(pane.read().mouseTracking, false);
});
