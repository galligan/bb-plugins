import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_REX_MESSAGE_BYTES,
  parseRexMessage,
  RexMessageSplitter,
  type StreamPart,
} from "./rex-messages.ts";

const NONCE = "12345678901234567890";
const encode = (text: string) => new TextEncoder().encode(text);
const message = (json: string, nonce = NONCE) =>
  `\x1b_rex1;${nonce};${json}\x1b\\`;

/** Parts as plain values: VT as text, messages as their JSON. */
function describe(parts: StreamPart[]): unknown[] {
  return parts.map((part) =>
    part.kind === "vt"
      ? new TextDecoder().decode(part.bytes)
      : { json: part.json },
  );
}

/** Pushes the chunks in order and joins neighbouring VT parts. */
function split(chunks: string[]): unknown[] {
  const splitter = new RexMessageSplitter(NONCE);
  const joined: unknown[] = [];
  for (const chunk of chunks) {
    for (const part of describe(splitter.push(encode(chunk)))) {
      const previous = joined.at(-1);
      if (typeof part === "string" && typeof previous === "string") {
        joined[joined.length - 1] = previous + part;
      } else {
        joined.push(part);
      }
    }
  }
  return joined;
}

test("passes plain terminal output through", () => {
  assert.deepEqual(split(["hello \x1b[1mworld\x1b[0m"]), [
    "hello \x1b[1mworld\x1b[0m",
  ]);
});

test("pulls a message out from between terminal output", () => {
  const stream = `before${message('{"type":"resize","cols":80,"rows":24}')}after`;
  assert.deepEqual(split([stream]), [
    "before",
    { json: { type: "resize", cols: 80, rows: 24 } },
    "after",
  ]);
});

test("gives the same parts wherever the stream is cut", () => {
  const stream = `ab${message('{"type":"child_exited","exit_code":3}')}cd${message('{"type":"theme"}')}`;
  const whole = split([stream]);
  for (let cut = 1; cut < stream.length; cut++) {
    assert.deepEqual(
      split([stream.slice(0, cut), stream.slice(cut)]),
      whole,
      `cut at ${cut}`,
    );
  }
});

test("gives the same parts one byte at a time", () => {
  const stream = `x${message('{"type":"resize","cols":1,"rows":1}')}y`;
  assert.deepEqual(split([...stream]), split([stream]));
});

test("leaves a look-alike with another nonce in the terminal output", () => {
  const forged = message('{"type":"resize","cols":1,"rows":1}', "999");
  assert.deepEqual(split([`a${forged}b`]), [`a${forged}b`]);
});

test("holds an escape at the end of a chunk until it is known not to be a message", () => {
  const splitter = new RexMessageSplitter(NONCE);
  assert.deepEqual(describe(splitter.push(encode("abc\x1b"))), ["abc"]);
  assert.deepEqual(describe(splitter.push(encode("[0m"))), ["\x1b[0m"]);
});

test("keeps multi-byte text intact around a message", () => {
  const stream = `héllo ${message('{"type":"theme"}')}wörld ✓`;
  assert.deepEqual(split([stream]), [
    "héllo ",
    { json: { type: "theme" } },
    "wörld ✓",
  ]);
});

test("gives up on a message that never ends instead of holding the stream", () => {
  const splitter = new RexMessageSplitter(NONCE);
  const chunk = encode("x".repeat(16 * 1024));
  splitter.push(encode(`before\x1b_rex1;${NONCE};{"type":"`));
  assert.throws(() => {
    // Far more than the limit, so the test ends if nothing is ever thrown.
    for (let sent = 0; sent < 4 * MAX_REX_MESSAGE_BYTES; sent += chunk.length) {
      splitter.push(chunk);
    }
  }, /did not end it within 64 KiB/);
});

test("still reads a long message that ends within the limit", () => {
  const padding = "x".repeat(MAX_REX_MESSAGE_BYTES - 1024);
  const stream = `a${message(`{"type":"later","padding":"${padding}"}`)}b`;
  const cut = Math.floor(stream.length / 2);
  assert.deepEqual(split([stream.slice(0, cut), stream.slice(cut)]), [
    "a",
    { json: { type: "later", padding } },
    "b",
  ]);
});

test("does not limit terminal output that only looks like the start of a message", () => {
  const forged = `\x1b_rex1;999;${"x".repeat(2 * MAX_REX_MESSAGE_BYTES)}`;
  assert.deepEqual(split([forged, "tail"]), [`${forged}tail`]);
});

test("passes on a message whose JSON does not parse as one with no type", () => {
  assert.deepEqual(split([message("{nope")]), [{ json: null }]);
  assert.deepEqual(parseRexMessage(null), { type: "unknown" });
});

test("reads the documented message types", () => {
  assert.deepEqual(
    parseRexMessage({
      type: "resize",
      cols: 120,
      rows: 40,
      cell_width_px: 8,
      cell_height_px: 17,
      owner: null,
    }),
    {
      type: "resize",
      cols: 120,
      rows: 40,
      cell_width_px: 8,
      cell_height_px: 17,
    },
  );
  assert.deepEqual(parseRexMessage({ type: "child_exited", exit_code: 0 }), {
    type: "child_exited",
    exit_code: 0,
  });
});

test("skips Rex's theme, which the tab does not draw from", () => {
  assert.deepEqual(
    parseRexMessage({ type: "theme", foreground: "d6deeb", scheme: "dark" }),
    { type: "unknown" },
  );
});

test("skips a type it does not know and a known type with bad fields", () => {
  assert.deepEqual(parseRexMessage({ type: "later_addition" }), {
    type: "unknown",
  });
  assert.deepEqual(parseRexMessage({ type: "resize", cols: 0, rows: 24 }), {
    type: "unknown",
  });
});
