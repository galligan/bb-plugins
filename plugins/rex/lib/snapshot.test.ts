import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findSnapshotEnd,
  newSnapshotScan,
  SnapshotFormatError,
} from "./snapshot.ts";

const TAG_FINISH = 6;

function envelope(version = 1): number[] {
  return [
    ...new TextEncoder().encode("GHOSTSNP"),
    version & 0xff,
    version >> 8,
  ];
}

function record(tag: number, payload: number[]): number[] {
  const header = new Uint8Array(10);
  const view = new DataView(header.buffer);
  view.setUint16(0, tag, true);
  view.setUint32(2, payload.length, true);
  return [...header, ...payload];
}

const snapshot = [
  ...envelope(),
  ...record(1, [1, 2, 3]),
  ...record(2, []),
  ...record(TAG_FINISH, [9, 9]),
];

test("reports the end of a complete snapshot", () => {
  const bytes = Uint8Array.from(snapshot);
  assert.equal(findSnapshotEnd(bytes, newSnapshotScan()), snapshot.length);
});

test("stops at FINISH when live bytes follow in the same chunk", () => {
  const bytes = Uint8Array.from([...snapshot, 0x1b, 0x5b, 0x48]);
  assert.equal(findSnapshotEnd(bytes, newSnapshotScan()), snapshot.length);
});

test("asks for more bytes at every cut short of the end", () => {
  const scan = newSnapshotScan();
  for (let length = 0; length < snapshot.length; length++) {
    const bytes = Uint8Array.from(snapshot.slice(0, length));
    assert.equal(findSnapshotEnd(bytes, scan), null, `cut at ${length}`);
  }
  assert.equal(
    findSnapshotEnd(Uint8Array.from(snapshot), scan),
    snapshot.length,
  );
});

test("does not walk a finished record again", () => {
  const scan = newSnapshotScan();
  const firstRecordEnd = envelope().length + 13;
  findSnapshotEnd(Uint8Array.from(snapshot.slice(0, firstRecordEnd + 4)), scan);
  assert.equal(scan.offset, firstRecordEnd);
});

test("reads the scan through a view with a byte offset", () => {
  const padded = Uint8Array.from([0xff, 0xff, ...snapshot]);
  const bytes = padded.subarray(2);
  assert.equal(findSnapshotEnd(bytes, newSnapshotScan()), snapshot.length);
});

test("names a format version it cannot decode", () => {
  const bytes = Uint8Array.from([...envelope(2), ...record(TAG_FINISH, [])]);
  assert.throws(
    () => findSnapshotEnd(bytes, newSnapshotScan()),
    (error) => {
      assert.ok(error instanceof SnapshotFormatError);
      assert.deepEqual(error.problem, {
        kind: "unsupported-version",
        version: 2,
      });
      assert.match(error.message, /version 2/);
      assert.match(error.message, /out of step/);
      return true;
    },
  );
});

test("rejects a stream that is not a snapshot before the envelope is whole", () => {
  const bytes = new TextEncoder().encode("GHX");
  assert.throws(
    () => findSnapshotEnd(bytes, newSnapshotScan()),
    (error) =>
      error instanceof SnapshotFormatError &&
      error.problem.kind === "not-a-snapshot",
  );
});
