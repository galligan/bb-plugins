// Scrolling, against the vendored ghostty-vt.wasm.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  history,
  lines,
  NONCE,
  openPane,
  SIZE,
  snapshotWithLines,
} from "./pane-fixture.ts";

test("a snapshot brings the terminal's earlier output with it", async () => {
  const pane = await openPane(await snapshotWithLines(300));
  const frame = pane.read();
  // 300 lines and the empty line the cursor is left on, less the screen.
  assert.equal(history(frame), 301 - SIZE.rows);
  assert.equal(
    frame.scroll.offset,
    history(frame),
    "it opens on the live screen",
  );
  assert.equal(pane.text(frame, SIZE.rows - 2), "line 300");

  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
});

test("scrolls back by rows, stops at the oldest row, and returns to the live screen", async () => {
  const pane = await openPane(await snapshotWithLines(100));
  const live = pane.read().scroll.offset;

  pane.scroll({ kind: "rows", rows: -5 });
  let frame = pane.read();
  assert.equal(frame.scroll.offset, live - 5);
  assert.equal(pane.text(frame, 0), "line 87");
  assert.equal(frame.cursor, null, "the cursor is below the view");

  pane.scroll({ kind: "rows", rows: 3 });
  assert.equal(pane.read().scroll.offset, live - 2);

  pane.scroll({ kind: "rows", rows: -100_000 });
  assert.equal(pane.read().scroll.offset, 0);
  assert.equal(pane.top(), "line 1");

  pane.scroll({ kind: "rows", rows: 100_000 });
  assert.equal(pane.read().scroll.offset, live);

  pane.scroll({ kind: "row", row: 40 });
  assert.equal(pane.top(), "line 41");
  pane.scroll({ kind: "bottom" });
  frame = pane.read();
  assert.equal(frame.scroll.offset, live);
  assert.notEqual(frame.cursor, null);
});

test("new output does not move a view that is scrolled back", async () => {
  const pane = await openPane(await snapshotWithLines(100));
  pane.scroll({ kind: "row", row: 40 });
  const before = pane.read();

  pane.feed(lines(25, 101));
  const after = pane.read();
  assert.equal(after.scroll.offset, before.scroll.offset);
  assert.deepEqual(after.lines, before.lines);
  assert.equal(after.scroll.total, before.scroll.total + 25);
});

test("new output is followed while the view is on the live screen", async () => {
  const pane = await openPane(await snapshotWithLines(100));
  pane.feed(lines(25, 101));
  const frame = pane.read();
  assert.equal(frame.scroll.offset, history(frame));
  assert.equal(pane.text(frame, SIZE.rows - 2), "line 125");
});

test("a resize keeps the first row of a view that is scrolled back", async () => {
  const pane = await openPane(await snapshotWithLines(100));
  pane.scroll({ kind: "row", row: 40 });
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
  const pane = await openPane(await snapshotWithLines(100));
  assert.equal(pane.read().alternateScreen, false);

  pane.feed("\x1b[?1049h\x1b[Hfull screen");
  let frame = pane.read();
  assert.equal(frame.alternateScreen, true);
  assert.deepEqual(frame.scroll, { total: SIZE.rows, offset: 0 });
  pane.scroll({ kind: "rows", rows: -5 });
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
  const pane = await openPane(await snapshotWithLines(5));
  assert.equal(pane.read().mouseTracking, false);
  pane.feed("\x1b[?1000h");
  assert.equal(pane.read().mouseTracking, true);
  pane.feed("\x1b[?1000l");
  assert.equal(pane.read().mouseTracking, false);
});
