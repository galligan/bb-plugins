import assert from "node:assert/strict";
import { test } from "node:test";

import { HistoryClearScan } from "./history-clear.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const scan = (...chunks: string[]) => {
  const scanner = new HistoryClearScan();
  return chunks.map((chunk) => scanner.push(bytes(chunk)));
};

test("finds the sequence that erases the scrollback", () => {
  assert.deepEqual(scan("\x1b[3J"), [true]);
  assert.deepEqual(scan("before\x1b[H\x1b[2J\x1b[3Jafter"), [true]);
});

test("finds a full reset", () => {
  assert.deepEqual(scan("\x1bc"), [true]);
  assert.deepEqual(scan("text\x1bcmore"), [true]);
});

test("finds a sequence split across chunks, wherever it is split", () => {
  assert.deepEqual(scan("abc\x1b", "[3J"), [false, true]);
  assert.deepEqual(scan("\x1b[", "3Jx"), [false, true]);
  assert.deepEqual(scan("\x1b[3", "J"), [false, true]);
  assert.deepEqual(scan("\x1b", "[", "3", "J"), [false, false, false, true]);
  assert.deepEqual(scan("\x1b", "c"), [false, true]);
});

test("ignores output that clears no history", () => {
  assert.deepEqual(scan("plain text, 3J and c"), [false]);
  assert.deepEqual(scan("\x1b[2J\x1b[H\x1b[0J\x1b[1J"), [false]);
  assert.deepEqual(scan("\x1b[33J", "\x1b[3;1J", "\x1b[31m"), [
    false,
    false,
    false,
  ]);
  assert.deepEqual(scan("\x1b[3", "x", "J"), [false, false, false]);
  assert.deepEqual(scan("\x1b]0;title c\x1b\\"), [false]);
});

test("starts again at an escape inside a sequence that was not one", () => {
  assert.deepEqual(scan("\x1b[\x1b[3J"), [true]);
  assert.deepEqual(scan("\x1b\x1bc"), [true]);
  assert.deepEqual(scan("\x1b[3\x1bc"), [true]);
});

test("reports each chunk on its own", () => {
  assert.deepEqual(scan("\x1b[3J", "quiet", "\x1bc\x1b[3J"), [
    true,
    false,
    true,
  ]);
});
