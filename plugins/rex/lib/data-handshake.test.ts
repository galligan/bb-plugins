import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeReject,
  encodeDataHello,
  parseDataHandshakeReply,
} from "./data-handshake.ts";

test("encodes a HELLO as 0x01 and the 16 ticket bytes", () => {
  // The example ticket from the Rex API page: bytes 0x00 through 0x0f.
  const hello = encodeDataHello("AAECAwQFBgcICQoLDA0ODw");
  assert.deepEqual(
    [...hello],
    [0x01, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  );
});

test("decodes the URL-safe alphabet", () => {
  const hello = encodeDataHello("-_-_-_-_-_-_-_-_-_-_-w");
  assert.equal(hello.length, 17);
  assert.deepEqual([...hello.subarray(1, 4)], [0xfb, 0xff, 0xbf]);
});

test("refuses a ticket of the wrong shape", () => {
  assert.throws(() => encodeDataHello("AAECAwQFBgcICQoLDA0ODw=="));
  assert.throws(() => encodeDataHello("too-short"));
  assert.throws(() => encodeDataHello("AAECAwQFBgcICQoLDA0OD+"));
});

function welcome(nonce: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x81;
  bytes.fill(0xaa, 1, 17); // The reconnect token.
  view.setUint32(20, 60_000, true);
  view.setBigUint64(24, nonce, true);
  return bytes;
}

test("reads the channel nonce from a WELCOME as decimal", () => {
  assert.deepEqual(parseDataHandshakeReply(welcome(1n)), {
    kind: "welcome",
    nonce: "1",
  });
  // Past 2^53, where a JavaScript number would lose digits.
  assert.deepEqual(parseDataHandshakeReply(welcome(18446744073709551615n)), {
    kind: "welcome",
    nonce: "18446744073709551615",
  });
});

test("reads a WELCOME through a view with a byte offset", () => {
  const padded = new Uint8Array(40);
  padded.set(welcome(42n), 8);
  assert.deepEqual(parseDataHandshakeReply(padded.subarray(8)), {
    kind: "welcome",
    nonce: "42",
  });
});

test("reads a REJECT and its reason", () => {
  const reply = parseDataHandshakeReply(Uint8Array.from([0x82, 0x02]));
  assert.deepEqual(reply, { kind: "reject", reason: 2 });
  assert.match(describeReject(2), /already has a connection/);
  assert.equal(describeReject(0x7f), "reason 0x7f");
});

test("refuses an answer that is neither", () => {
  assert.throws(() => parseDataHandshakeReply(new Uint8Array(0)));
  assert.throws(() => parseDataHandshakeReply(welcome(1n).subarray(0, 31)));
  assert.throws(() => parseDataHandshakeReply(Uint8Array.from([0x82])));
});
