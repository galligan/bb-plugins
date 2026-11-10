import assert from "node:assert/strict";
import { test } from "node:test";

import { rowAfterDrag, sliderGeometry } from "./scrollbar.ts";

test("sizes and places the slider as bb's terminal does", () => {
  // Measured in bb: 504 rows, 73 shown, an 876-pixel track.
  assert.deepEqual(sliderGeometry({ total: 504, offset: 431, rows: 73 }, 876), {
    top: 749,
    height: 127,
  });
  assert.deepEqual(sliderGeometry({ total: 504, offset: 0, rows: 73 }, 876), {
    top: 0,
    height: 127,
  });
  const partWay = sliderGeometry({ total: 504, offset: 322, rows: 73 }, 876);
  assert.equal(partWay?.top, Math.round((749 * 322) / 431));
});

test("has no slider when every row is on screen", () => {
  assert.equal(sliderGeometry({ total: 24, offset: 0, rows: 24 }, 300), null);
  assert.equal(sliderGeometry({ total: 10, offset: 0, rows: 24 }, 300), null);
  assert.equal(sliderGeometry({ total: 500, offset: 0, rows: 24 }, 0), null);
});

test("keeps the slider tall enough to grab with a long history", () => {
  const slider = sliderGeometry(
    { total: 10_024, offset: 10_000, rows: 24 },
    300,
  );
  assert.deepEqual(slider, { top: 280, height: 20 });
});

test("keeps the slider inside the track for an offset out of range", () => {
  const extent = { total: 100, rows: 20 };
  assert.equal(sliderGeometry({ ...extent, offset: 500 }, 200)?.top, 160);
  assert.equal(sliderGeometry({ ...extent, offset: -5 }, 200)?.top, 0);
});

test("turns a drag of the slider into the row to show first", () => {
  const extent = { total: 504, offset: 431, rows: 73 };
  // The slider has 749 pixels of travel for 431 rows.
  assert.equal(rowAfterDrag(extent, 876, 431, -749), 0);
  assert.equal(rowAfterDrag(extent, 876, 431, 0), 431);
  assert.equal(rowAfterDrag(extent, 876, 0, 749), 431);
  assert.equal(rowAfterDrag(extent, 876, 431, -374.5), 216);
});

test("stops a drag at either end of the history", () => {
  const extent = { total: 504, offset: 431, rows: 73 };
  assert.equal(rowAfterDrag(extent, 876, 431, -5000), 0);
  assert.equal(rowAfterDrag(extent, 876, 100, 5000), 431);
});

test("leaves the view alone when there is nothing to drag", () => {
  assert.equal(rowAfterDrag({ total: 24, offset: 0, rows: 24 }, 300, 0, 50), 0);
});
