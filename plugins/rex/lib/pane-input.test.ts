import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockEventFor,
  MAX_INPUT_BATCH,
  MAX_PASTE_CHARS,
  paneInputBatchSchema,
  setThemeArgsFor,
  type PaneInput,
  type RexKey,
  type TerminalTheme,
} from "./pane-input.ts";

const theme: TerminalTheme = {
  foreground: "cfcfcf",
  background: "1f1f1f",
  cursor: "cfcfcf",
  ansi: Array.from({ length: 16 }, (_, index) =>
    (index * 0x111111).toString(16).padStart(6, "0"),
  ),
};

const key: RexKey = {
  key: "key_g",
  mods: "ctrl",
  consumed_mods: "",
  text: "",
  unshifted_codepoint: 103,
  composing: false,
  action: "press",
};

const batch = (events: unknown[]) => ({ pane: "pane-1", events });

test("accepts each kind of input", () => {
  const events: PaneInput[] = [
    { type: "key", key },
    { type: "paste", text: "echo hello\n" },
    { type: "focus", focused: true },
    {
      type: "resize",
      size: { cols: 80, rows: 24, cellWidthPx: 7, cellHeightPx: 16 },
    },
    { type: "theme", theme },
  ];
  assert.deepEqual(paneInputBatchSchema.parse(batch(events)).events, events);
});

test("refuses input that is not exactly one of those shapes", () => {
  const refused: unknown[] = [
    { type: "key", key: { ...key, key: "Key G" } },
    { type: "key", key: { ...key, mods: "ctrl; rm -rf" } },
    { type: "key", key: { ...key, action: "release" } },
    { type: "key", key: { ...key, composing: true } },
    { type: "key", key: { ...key, unshifted_codepoint: -1 } },
    { type: "key", key: { ...key, extra: 1 } },
    { type: "paste", text: "" },
    { type: "paste", text: "x".repeat(MAX_PASTE_CHARS + 1) },
    { type: "focus", focused: "yes" },
    {
      type: "resize",
      size: { cols: 0, rows: 24, cellWidthPx: 7, cellHeightPx: 16 },
    },
    {
      type: "resize",
      size: { cols: 80.5, rows: 24, cellWidthPx: 7, cellHeightPx: 16 },
    },
    { type: "theme", theme: { ...theme, foreground: "#cfcfcf" } },
    { type: "theme", theme: { ...theme, background: "red" } },
    { type: "theme", theme: { ...theme, ansi: theme.ansi.slice(0, 15) } },
    { type: "theme", theme: { ...theme, ansi: [...theme.ansi, "000000"] } },
    { type: "theme", theme: { ...theme, scheme: "dark" } },
    { type: "write", data: "x" },
  ];
  for (const event of refused) {
    assert.equal(
      paneInputBatchSchema.safeParse(batch([event])).success,
      false,
      JSON.stringify(event).slice(0, 80),
    );
  }
});

test("bounds a batch and requires a pane", () => {
  const focus = { type: "focus", focused: true };
  const full = Array.from({ length: MAX_INPUT_BATCH }, () => focus);
  assert.equal(paneInputBatchSchema.safeParse(batch(full)).success, true);
  assert.equal(
    paneInputBatchSchema.safeParse(batch([...full, focus])).success,
    false,
  );
  assert.equal(paneInputBatchSchema.safeParse(batch([])).success, false);
  assert.equal(
    paneInputBatchSchema.safeParse({ pane: "", events: [focus] }).success,
    false,
  );
  assert.equal(
    paneInputBatchSchema.safeParse({ events: [focus] }).success,
    false,
  );
});

test("turns input into the event of a block.event call", () => {
  assert.deepEqual(blockEventFor({ type: "key", key }), {
    type: "key",
    payload: key,
  });
  assert.deepEqual(blockEventFor({ type: "paste", text: "ls\n" }), {
    type: "paste",
    payload: { text: "ls\n" },
  });
  assert.deepEqual(blockEventFor({ type: "focus", focused: true }), {
    type: "focus",
    payload: { action: "in" },
  });
  assert.deepEqual(blockEventFor({ type: "focus", focused: false }), {
    type: "focus",
    payload: { action: "out" },
  });
});

test("writes a theme as the arguments of Rex's set_theme", () => {
  const args = setThemeArgsFor(theme);
  assert.deepEqual(
    [args.foreground, args.background, args.cursor],
    ["cfcfcf", "1f1f1f", "cfcfcf"],
  );
  assert.equal(args.palette.length, 16);
  assert.deepEqual(
    [args.palette[0], args.palette[1], args.palette[15]],
    ["0=000000", "1=111111", "15=ffffff"],
  );
});
