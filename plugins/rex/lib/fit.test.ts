import assert from "node:assert/strict";
import { test } from "node:test";

import { cellSize, fitGrid } from "./fit.ts";

const cell = { cellWidth: 7.2, cellHeight: 16 };

test("fits whole cells into the space", () => {
  assert.deepEqual(fitGrid({ width: 576, height: 384, ...cell }), {
    cols: 80,
    rows: 24,
  });
  // A partial cell at either edge is left empty.
  assert.deepEqual(fitGrid({ width: 583, height: 399, ...cell }), {
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(fitGrid({ width: 575.9, height: 383, ...cell }), {
    cols: 79,
    rows: 23,
  });
});

test("asks for nothing while the panel is hidden or collapsed", () => {
  assert.equal(fitGrid({ width: 0, height: 0, ...cell }), null);
  assert.equal(fitGrid({ width: 60, height: 400, ...cell }), null);
  assert.equal(fitGrid({ width: 600, height: 20, ...cell }), null);
});

test("asks for nothing when a cell could not be measured", () => {
  const space = { width: 600, height: 400 };
  assert.equal(fitGrid({ ...space, cellWidth: 0, cellHeight: 16 }), null);
  assert.equal(fitGrid({ ...space, cellWidth: 7.2, cellHeight: 0 }), null);
  assert.equal(
    fitGrid({ ...space, cellWidth: Number.NaN, cellHeight: 16 }),
    null,
  );
  assert.equal(fitGrid({ width: Number.NaN, height: 400, ...cell }), null);
});

test("caps a very large panel", () => {
  assert.deepEqual(fitGrid({ width: 100_000, height: 100_000, ...cell }), {
    cols: 500,
    rows: 200,
  });
});

test("sizes a cell the way bb's terminal does", () => {
  // Measured in bb for its terminal font at 12px.
  const font = { advance: 7.41796875, ascent: 10, descent: 2 };
  assert.deepEqual(cellSize({ ...font, devicePixelRatio: 1 }), {
    width: 7,
    height: 12,
  });
  // On a 2x display the cell can end on a half CSS pixel.
  assert.deepEqual(cellSize({ ...font, devicePixelRatio: 2 }), {
    width: 7,
    height: 12,
  });
  assert.deepEqual(
    cellSize({ advance: 7.8, ascent: 10.3, descent: 2.4, devicePixelRatio: 2 }),
    { width: 7.5, height: 13 },
  );
});

test("reports no cell size for a font that could not be measured", () => {
  assert.equal(
    cellSize({ advance: 0, ascent: 0, descent: 0, devicePixelRatio: 1 }),
    null,
  );
  assert.equal(
    cellSize({
      advance: Number.NaN,
      ascent: 10,
      descent: 2,
      devicePixelRatio: 1,
    }),
    null,
  );
});
