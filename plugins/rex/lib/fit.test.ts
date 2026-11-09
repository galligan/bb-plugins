import assert from "node:assert/strict";
import { test } from "node:test";

import { fitGrid } from "./fit.ts";

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
