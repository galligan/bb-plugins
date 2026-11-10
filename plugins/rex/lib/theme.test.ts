import assert from "node:assert/strict";
import { test } from "node:test";

import { parseColor, parseTheme } from "./theme.ts";

test("reads a color with or without the hash", () => {
  assert.equal(parseColor("d6deeb"), 0xd6deeb);
  assert.equal(parseColor("#011627"), 0x011627);
  assert.equal(parseColor("#FFFFFF"), 0xffffff);
});

test("treats a missing, empty, or malformed color as the built-in one", () => {
  assert.equal(parseColor(undefined), null);
  assert.equal(parseColor(""), null);
  assert.equal(parseColor("#fff"), null);
  assert.equal(parseColor("red"), null);
  assert.equal(parseColor("#0116270"), null);
});

test("reads a full theme", () => {
  const theme = parseTheme({
    foreground: "#d6deeb",
    background: "011627",
    cursor: "#80a4c2",
    palette: ["1=#ef5350", "255=ffffff", "0=000000"],
  });
  assert.equal(theme.foreground, 0xd6deeb);
  assert.equal(theme.background, 0x011627);
  assert.equal(theme.cursor, 0x80a4c2);
  assert.deepEqual(
    [...theme.palette],
    [
      [1, 0xef5350],
      [255, 0xffffff],
      [0, 0x000000],
    ],
  );
});

test("leaves every color built-in for an empty theme", () => {
  const theme = parseTheme({});
  assert.deepEqual(
    [theme.foreground, theme.background, theme.cursor, theme.palette.size],
    [null, null, null, 0],
  );
  assert.equal(parseTheme({ palette: null }).palette.size, 0);
});

test("skips palette entries that do not parse", () => {
  const theme = parseTheme({
    palette: ["256=ffffff", "x=ffffff", "3=nope", "4", "5=#00ff00"],
  });
  assert.deepEqual([...theme.palette], [[5, 0x00ff00]]);
});
