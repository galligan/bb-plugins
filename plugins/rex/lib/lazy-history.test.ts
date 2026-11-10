// Restoring a snapshot's history a page at a time, against the vendored
// ghostty-vt.wasm.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  history,
  lines,
  openPane,
  SIZE,
  snapshotWithLines,
} from "./pane-fixture.ts";
import { RESTORE_AHEAD_ROWS } from "./pane-view.ts";
import { pendingRows } from "./snapshot-history.ts";

const PRINTED = 20_000;
/** Every printed line and the empty one the cursor is left on. */
const ALL_ROWS = PRINTED + 1;
const long = await snapshotWithLines(PRINTED);

test("shows the screen before the history above it is restored", async () => {
  const pane = await openPane(long);
  const frame = pane.read();
  assert.equal(pane.text(frame, SIZE.rows - 2), `line ${PRINTED}`);
  assert.equal(pane.view.historyRestored, false);
  assert.ok(pane.held() < 1000, `restored ${pane.held()} rows with the screen`);
});

test("counts the whole history from the start", async () => {
  const pane = await openPane(long);
  const frame = pane.read();
  assert.equal(frame.scroll.total, ALL_ROWS);
  assert.equal(frame.scroll.offset, history(frame), "on the live screen");
});

test("restores older pages as the view nears them, without the count changing", async () => {
  const pane = await openPane(long);
  let offset = pane.read().scroll.offset;
  for (let step = 0; step < 12; step++) {
    pane.scroll({ kind: "rows", rows: -700 });
    offset -= 700;
    const frame = pane.read();
    assert.deepEqual(frame.scroll, { total: ALL_ROWS, offset });
    // Lines are numbered from 1 and none wraps, so a row shows its own number.
    assert.equal(pane.text(frame, 0), `line ${offset + 1}`);
  }
  assert.equal(pane.view.historyRestored, false, "the rest still waits");
  assert.ok(pane.held() < PRINTED / 2, `restored ${pane.held()} rows`);
});

test("keeps restored rows above the view until the history runs out", async () => {
  const pane = await openPane(long);
  for (;;) {
    pane.scroll({ kind: "rows", rows: -333 });
    const { scroll } = pane.read();
    const restoredAbove = scroll.offset - (ALL_ROWS - SIZE.rows - pane.held());
    if (pane.view.historyRestored) break;
    assert.ok(
      restoredAbove >= RESTORE_AHEAD_ROWS,
      `${restoredAbove} rows above the view at row ${scroll.offset}`,
    );
  }
  // The real top is reached only once everything is there.
  pane.scroll({ kind: "rows", rows: -PRINTED });
  assert.equal(pane.read().scroll.offset, 0);
  assert.equal(pane.top(), "line 1");
});

test("a jump to any row lands on that row", async () => {
  const pane = await openPane(long);
  pane.scroll({ kind: "row", row: 12_345 });
  assert.equal(pane.top(), "line 12346");
  assert.equal(pane.read().scroll.offset, 12_345);
  assert.equal(pane.view.historyRestored, false);

  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
  assert.deepEqual(pane.read().scroll, { total: ALL_ROWS, offset: 0 });
  assert.equal(pane.view.historyRestored, true);

  pane.scroll({ kind: "bottom" });
  const frame = pane.read();
  assert.equal(frame.scroll.offset, history(frame));
  assert.equal(pane.text(frame, SIZE.rows - 2), `line ${PRINTED}`);
});

test("output between pages lands below the history still to come", async () => {
  const pane = await openPane(long);
  pane.scroll({ kind: "rows", rows: -2000 });
  const before = pane.read();

  pane.feed(lines(500, PRINTED + 1));
  const after = pane.read();
  assert.equal(after.scroll.offset, before.scroll.offset, "the view stayed");
  assert.equal(after.scroll.total, ALL_ROWS + 500);
  assert.deepEqual(after.lines, before.lines);

  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
  pane.scroll({ kind: "bottom" });
  assert.equal(pane.text(pane.read(), SIZE.rows - 2), `line ${PRINTED + 500}`);
});

test("restores no more history than the limit", async () => {
  const limit = 5_000;
  const pane = await openPane(long, limit);
  const frame = pane.read();
  assert.ok(
    history(frame) <= limit && history(frame) > limit - 1000,
    `counted ${history(frame)} rows from the start`,
  );

  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.view.historyRestored, true);
  assert.ok(pane.held() <= limit, `holds ${pane.held()} rows`);
  // The oldest row kept is as far back as the rows held reach.
  const oldest = Number(pane.top().replace("line ", ""));
  assert.equal(oldest, ALL_ROWS - SIZE.rows - pane.held() + 1);
  assert.ok(oldest > PRINTED - limit);
});

test("output that fills the terminal ends the restoring", async () => {
  const limit = 5_000;
  const pane = await openPane(long, limit);
  pane.feed(lines(limit + 2000, PRINTED + 1));
  const frame = pane.read();
  assert.equal(pane.view.historyRestored, true);
  assert.ok(pane.held() <= limit, `holds ${pane.held()} rows`);
  assert.equal(history(frame), pane.held(), "nothing more is counted");
});

test("holds the history to the limit as more output arrives", async () => {
  const limit = 5_000;
  const pane = await openPane(await snapshotWithLines(100), limit);
  pane.feed(lines(3 * limit, 101));
  const kept = history(pane.read());
  assert.ok(kept > limit - 1000 && kept <= limit, `kept ${kept} rows`);
});

test("restores nothing while a full-screen program is showing", async () => {
  const pane = await openPane(long);
  const held = pane.held();
  pane.feed("\x1b[?1049h\x1b[Hfull screen");
  pane.scroll({ kind: "rows", rows: -50 });
  pane.scroll({ kind: "row", row: 0 });
  assert.deepEqual(pane.read().scroll, { total: SIZE.rows, offset: 0 });
  assert.equal(pane.view.historyRestored, false);

  pane.feed("\x1b[?1049l");
  assert.equal(pane.held(), held);
  assert.equal(pane.read().scroll.total, ALL_ROWS);
});

test("a snapshot taken while a full-screen program shows keeps its history", async () => {
  const pane = await openPane(
    await snapshotWithLines(3000, "\x1b[?1049h\x1b[Hfull screen"),
  );
  assert.equal(pane.top(), "full screen");
  assert.deepEqual(pane.read().scroll, { total: SIZE.rows, offset: 0 });

  pane.feed("\x1b[?1049l");
  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
  assert.equal(history(pane.read()), 3001 - SIZE.rows);
});

test("a short history is all there once the snapshot's pages are read", async () => {
  const pane = await openPane(await snapshotWithLines(50));
  assert.equal(history(pane.read()), 51 - SIZE.rows);
  pane.scroll({ kind: "row", row: 0 });
  assert.equal(pane.top(), "line 1");
  assert.equal(pane.view.historyRestored, true);
});

test("counts what is still to come as what remains, within the room left", () => {
  assert.equal(pendingRows({ remaining: 900, held: 100, maxRows: 5000 }), 900);
  assert.equal(
    pendingRows({ remaining: 9000, held: 100, maxRows: 5000 }),
    4900,
  );
  assert.equal(pendingRows({ remaining: 9000, held: 5000, maxRows: 5000 }), 0);
  assert.equal(pendingRows({ remaining: 9000, held: 5200, maxRows: 5000 }), 0);
  assert.equal(pendingRows({ remaining: 0, held: 100, maxRows: 5000 }), 0);
});
