import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ansiColor,
  buildRuns,
  cssColor,
  runColors,
  STYLE,
  textAt,
  THEME_COLOR,
  type Cell,
} from "./runs.ts";

const RED = 0xcc0000;
const BLUE = 0x0000cc;

function cell(text: string, overrides: Partial<Cell> = {}): Cell {
  return { text, width: 1, fg: null, bg: null, flags: 0, ...overrides };
}

const cells = (text: string, overrides: Partial<Cell> = {}) =>
  [...text].map((character) => cell(character, overrides));

const blank = (count: number) => Array.from({ length: count }, () => cell(""));

test("groups ASCII with the same look into one run", () => {
  assert.deepEqual(buildRuns(cells("hello")), [
    { text: "hello", cols: 5, pinned: false, fg: null, bg: null, flags: 0 },
  ]);
});

test("starts a run where the look changes", () => {
  const runs = buildRuns([
    ...cells("ab"),
    ...cells("cd", { fg: RED }),
    ...cells("ef", { fg: RED, flags: STYLE.bold }),
    ...cells("gh", { fg: RED, bg: BLUE, flags: STYLE.bold }),
  ]);
  assert.deepEqual(
    runs.map((run) => [run.text, run.fg, run.bg, run.flags]),
    [
      ["ab", null, null, 0],
      ["cd", RED, null, 0],
      ["ef", RED, null, STYLE.bold],
      ["gh", RED, BLUE, STYLE.bold],
    ],
  );
});

test("draws a cell with no text as a space", () => {
  const runs = buildRuns([cell("a"), cell(""), cell("b")]);
  assert.deepEqual(
    runs.map((run) => run.text),
    ["a b"],
  );
});

test("drops the blank end of a row and keeps blanks inside it", () => {
  const runs = buildRuns([...cells("a  b"), ...blank(76)]);
  assert.deepEqual(
    runs.map((run) => [run.text, run.cols]),
    [["a  b", 4]],
  );
  assert.deepEqual(buildRuns(blank(80)), []);
});

test("keeps a blank end that still paints something", () => {
  const withBackground = buildRuns([cell("a"), ...cells("  ", { bg: BLUE })]);
  assert.deepEqual(
    withBackground.map((run) => [run.text, run.bg]),
    [
      ["a", null],
      ["  ", BLUE],
    ],
  );
  const inverted = buildRuns(cells("  ", { flags: STYLE.inverse }));
  assert.equal(inverted.length, 1);
  const underlined = buildRuns(cells("  ", { flags: 1 << 8 }));
  assert.equal(underlined.length, 1);
});

test("pins every character outside printable ASCII to its own cell", () => {
  const runs = buildRuns([...cells("a│é"), cell("b")]);
  assert.deepEqual(
    runs.map((run) => [run.text, run.cols, run.pinned]),
    [
      ["a", 1, false],
      ["│", 1, true],
      ["é", 1, true],
      ["b", 1, false],
    ],
  );
});

test("gives a wide character two columns and skips its second half", () => {
  const runs = buildRuns([
    cell("a"),
    cell("語", { width: 2 }),
    cell("", { width: 0 }),
    cell("b"),
  ]);
  assert.deepEqual(
    runs.map((run) => [run.text, run.cols, run.pinned]),
    [
      ["a", 1, false],
      ["語", 2, true],
      ["b", 1, false],
    ],
  );
  assert.equal(
    runs.reduce((total, run) => total + run.cols, 0),
    4,
  );
});

test("pins a grapheme made of several code points as one cell", () => {
  const runs = buildRuns([cell("é"), cell("👍🏽", { width: 2 })]);
  assert.deepEqual(
    runs.map((run) => [run.cols, run.pinned]),
    [
      [1, true],
      [2, true],
    ],
  );
});

test("does not merge across a pinned run", () => {
  const runs = buildRuns([cell("a"), cell("→"), cell("b")]);
  assert.equal(runs.length, 3);
});

test("ignores style bits the renderer does not draw", () => {
  const blink = 1 << 3;
  const runs = buildRuns([cell("a"), cell("b", { flags: blink })]);
  assert.deepEqual(
    runs.map((run) => [run.text, run.flags]),
    [["ab", 0]],
  );
});

test("draws a run in its own colors, or the terminal's defaults", () => {
  assert.deepEqual(runColors({ fg: null, bg: null, flags: 0 }), {
    color: THEME_COLOR.foreground,
    background: null,
  });
  assert.deepEqual(runColors({ fg: RED, bg: BLUE, flags: 0 }), {
    color: RED,
    background: BLUE,
  });
});

test("swaps the colors of an inverse run, filling in the defaults", () => {
  assert.deepEqual(runColors({ fg: null, bg: null, flags: STYLE.inverse }), {
    color: THEME_COLOR.background,
    background: THEME_COLOR.foreground,
  });
  assert.deepEqual(runColors({ fg: RED, bg: BLUE, flags: STYLE.inverse }), {
    color: BLUE,
    background: RED,
  });
});

test("hides invisible text against whatever is behind it", () => {
  assert.deepEqual(runColors({ fg: RED, bg: null, flags: STYLE.invisible }), {
    color: THEME_COLOR.background,
    background: null,
  });
  assert.deepEqual(runColors({ fg: RED, bg: BLUE, flags: STYLE.invisible }), {
    color: BLUE,
    background: BLUE,
  });
});

test("draws bold text in the bright form of the first eight ANSI colors", () => {
  assert.equal(
    runColors({ fg: ansiColor(1), bg: null, flags: STYLE.bold }).color,
    ansiColor(9),
  );
  assert.equal(
    runColors({ fg: ansiColor(7), bg: null, flags: STYLE.bold }).color,
    ansiColor(15),
  );
  // Already bright, not bold, a color the program chose, or a background.
  assert.equal(
    runColors({ fg: ansiColor(9), bg: null, flags: STYLE.bold }).color,
    ansiColor(9),
  );
  assert.equal(
    runColors({ fg: ansiColor(1), bg: null, flags: 0 }).color,
    ansiColor(1),
  );
  assert.equal(runColors({ fg: RED, bg: null, flags: STYLE.bold }).color, RED);
  assert.deepEqual(
    runColors({ fg: null, bg: ansiColor(1), flags: STYLE.bold }),
    { color: THEME_COLOR.foreground, background: ansiColor(1) },
  );
});

test("writes a color a program chose as its own value", () => {
  assert.equal(cssColor(0x0000cc), "#0000cc");
  assert.equal(cssColor(0xffffff), "#ffffff");
  assert.equal(cssColor(0), "#000000");
});

test("writes a theme color as a reference to the app's variable", () => {
  assert.equal(cssColor(ansiColor(0)), "var(--ansi-0)");
  assert.equal(cssColor(ansiColor(15)), "var(--ansi-15)");
  assert.equal(cssColor(THEME_COLOR.foreground), "var(--foreground)");
  assert.equal(cssColor(THEME_COLOR.background), "var(--sidebar)");
});

test("keeps runs apart when one color is themed and the other is not", () => {
  const runs = buildRuns([
    cell("a", { fg: ansiColor(1) }),
    cell("b", { fg: 0x000001 }),
  ]);
  assert.equal(runs.length, 2);
});

test("finds the text under a column", () => {
  const runs = buildRuns([
    ...cells("ab"),
    cell("語", { width: 2 }),
    cell("", { width: 0 }),
    cell("é"),
    ...cells("cd", { fg: RED }),
  ]);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 40].map((col) => textAt(runs, col)),
    ["a", "b", "語", "語", "é", "c", "d", "", ""],
  );
  assert.equal(textAt([], 0), "");
});
