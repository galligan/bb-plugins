import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alternateScreenLines,
  historyRows,
  WholeRows,
  type WheelInput,
} from "./wheel.ts";

const CELL = 12;

function wheel(overrides: Partial<WheelInput>): WheelInput {
  return {
    deltaY: 0,
    deltaMode: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

test("one notch of a wheel scrolls the history 50 pixels, as in bb's terminal", () => {
  // Measured in bb: each notch moved its terminal four 12-pixel rows.
  const up = historyRows(wheel({ deltaY: -100, wheelDeltaY: 120 }), CELL);
  assert.equal(Math.trunc(up), -4);
  assert.equal(up, -50 / CELL);
  const down = historyRows(wheel({ deltaY: 100, wheelDeltaY: -120 }), CELL);
  assert.equal(down, 50 / CELL);
});

test("a trackpad's small movements scroll in proportion", () => {
  // Chromium reports three legacy units for each pixel of a trackpad scroll.
  const rows = historyRows(wheel({ deltaY: -8, wheelDeltaY: 24 }), CELL);
  assert.equal(rows, (-(24 / 120) * 50) / CELL);
  assert.ok(Math.abs(rows) < 1);
});

test("falls back to the standard delta where the legacy one is missing", () => {
  assert.equal(historyRows(wheel({ deltaY: -40 }), CELL), -50 / CELL);
  assert.equal(
    historyRows(wheel({ deltaY: -3, deltaMode: 1 }), CELL),
    (-3 * 50) / CELL,
  );
});

test("Alt makes the wheel go five times as far", () => {
  const plain = historyRows(wheel({ wheelDeltaY: 120 }), CELL);
  const fast = historyRows(wheel({ wheelDeltaY: 120, altKey: true }), CELL);
  assert.ok(Math.abs(fast - plain * 5) < 1e-9);
  assert.equal(Math.trunc(fast), -20);
});

test("scrolls nothing when a cell could not be measured", () => {
  assert.equal(historyRows(wheel({ wheelDeltaY: 120 }), 0), 0);
  assert.equal(alternateScreenLines(wheel({ deltaY: 100 }), 0, 24), 0);
});

test("on the alternate screen a large pixel movement counts in full", () => {
  assert.equal(alternateScreenLines(wheel({ deltaY: 120 }), CELL, 24), 10);
  assert.equal(alternateScreenLines(wheel({ deltaY: -60 }), CELL, 24), -5);
});

test("on the alternate screen a small pixel movement counts for less", () => {
  const lines = alternateScreenLines(wheel({ deltaY: 20 }), CELL, 24);
  assert.equal(lines, (20 / CELL) * 0.3);
});

test("on the alternate screen line and page deltas are taken as they are", () => {
  assert.equal(
    alternateScreenLines(wheel({ deltaY: 3, deltaMode: 1 }), CELL, 24),
    3,
  );
  assert.equal(
    alternateScreenLines(wheel({ deltaY: -1, deltaMode: 2 }), CELL, 24),
    -24,
  );
});

test("on the alternate screen Shift sends nothing and Alt or Ctrl goes further", () => {
  assert.equal(
    alternateScreenLines(wheel({ deltaY: 120, shiftKey: true }), CELL, 24),
    0,
  );
  assert.equal(
    alternateScreenLines(wheel({ deltaY: 120, altKey: true }), CELL, 24),
    50,
  );
  assert.equal(
    alternateScreenLines(wheel({ deltaY: 120, ctrlKey: true }), CELL, 24),
    50,
  );
});

test("carries part of a row from one event to the next", () => {
  const rows = new WholeRows();
  assert.equal(rows.take(-0.4), 0);
  assert.equal(rows.take(-0.4), 0);
  assert.equal(rows.take(-0.4), -1);
  assert.equal(rows.take(-4.2), -4);
  // Turning round first uses up what was left the other way.
  assert.equal(rows.take(0.5), 0);
  assert.equal(rows.take(1), 1);
});

test("forgets the remainder when asked", () => {
  const rows = new WholeRows();
  rows.take(0.9);
  rows.reset();
  assert.equal(rows.take(0.9), 0);
});
