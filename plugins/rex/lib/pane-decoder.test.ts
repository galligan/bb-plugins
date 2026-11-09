// Runs the vendored ghostty-vt.wasm. No Rex server is involved: a snapshot is
// made by encoding a terminal with the same build, as a Rex server would.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { Frame } from "./frame-reader.ts";
import { GHOSTTY_VT_BUILD } from "./ghostty-build.ts";
import { GhosttyVt } from "./ghostty.ts";
import { PaneDecoder } from "./pane-decoder.ts";
import { STYLE } from "./runs.ts";
import { SnapshotFormatError } from "./snapshot.ts";
import { GhosttyError } from "./wasm.ts";

const NONCE = "424242";
const wasmBytes = await readFile(
  new URL("../vendor/ghostty-vt.wasm", import.meta.url),
);
const wasmModule = await WebAssembly.compile(wasmBytes);

const encode = (text: string) => new TextEncoder().encode(text);
const rex = (json: object) =>
  `\x1b_rex1;${NONCE};${JSON.stringify(json)}\x1b\\`;

/** A snapshot of a terminal that `output` was written to. */
async function snapshotOf(
  output: string,
  size = { cols: 20, rows: 5 },
): Promise<Uint8Array> {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const terminal = vt.newTerminal(size.cols, size.rows);
  vt.write(terminal, encode(output));
  return vt.encodeSnapshot(terminal);
}

/** Feeds `stream` to a new decoder in chunks and reads the frame it leaves. */
async function decode(
  stream: Uint8Array,
  chunkBytes: number,
): Promise<{ frame: Frame; decoder: PaneDecoder }> {
  const vt = await GhosttyVt.instantiate(wasmModule);
  const decoder = new PaneDecoder(vt, NONCE);
  for (let offset = 0; offset < stream.length; offset += chunkBytes) {
    decoder.push(stream.subarray(offset, offset + chunkBytes));
  }
  assert.notEqual(decoder.terminal, null, "the snapshot was decoded");
  const reader = vt.newFrameReader(decoder.terminal ?? 0);
  return { frame: reader.read(), decoder };
}

const join = (...parts: Uint8Array[]) => Buffer.concat(parts);
const text = (frame: Frame, row: number) =>
  (frame.lines[row] ?? []).map((run) => run.text).join("");

test("the vendored WASM is the build the plugin records", async () => {
  assert.equal(
    createHash("sha256").update(wasmBytes).digest("hex"),
    GHOSTTY_VT_BUILD.sha256,
  );
  const vt = await GhosttyVt.instantiate(wasmModule);
  assert.equal(vt.version(), GHOSTTY_VT_BUILD.version);
});

test("restores the snapshot, then applies the live output after it", async () => {
  const stream = join(
    await snapshotOf("from snapshot\r\n"),
    encode("from live"),
  );
  const { frame } = await decode(stream, stream.length);
  assert.equal(frame.cols, 20);
  assert.equal(frame.rows, 5);
  assert.equal(frame.lines.length, 5);
  assert.equal(text(frame, 0), "from snapshot");
  assert.equal(text(frame, 1), "from live");
  assert.deepEqual(frame.lines[2], []);
});

test("gives the same frame however the stream is cut into chunks", async () => {
  const stream = join(
    await snapshotOf("one\r\n"),
    encode(rex({ type: "resize", cols: 30, rows: 4 })),
    encode("two \x1b[1;31mred\x1b[0m\r\nthree"),
  );
  const whole = await decode(stream, stream.length);
  for (const chunkBytes of [1, 7, 64, 1000]) {
    const cut = await decode(stream, chunkBytes);
    assert.deepEqual(cut.frame, whole.frame, `chunks of ${chunkBytes}`);
  }
});

test("draws at the size Rex reports", async () => {
  const stream = join(
    await snapshotOf("hi"),
    encode(
      rex({
        type: "resize",
        cols: 33,
        rows: 7,
        cell_width_px: 0,
        cell_height_px: 0,
        owner: null,
      }),
    ),
  );
  const { frame } = await decode(stream, 50);
  assert.deepEqual([frame.cols, frame.rows, frame.lines.length], [33, 7, 7]);
  assert.equal(text(frame, 0), "hi");
});

test("reads colors and attributes into runs", async () => {
  const stream = join(
    await snapshotOf(""),
    encode("plain \x1b[1;38;2;10;20;30mbold\x1b[0m \x1b[7;4minv\x1b[0m"),
  );
  const { frame } = await decode(stream, stream.length);
  const [plain, bold, gap, inverse] = frame.lines[0] ?? [];
  assert.deepEqual([plain?.text, plain?.fg, plain?.flags], ["plain ", null, 0]);
  assert.deepEqual(
    [bold?.text, bold?.fg, bold?.flags],
    ["bold", 0x0a141e, STYLE.bold],
  );
  assert.equal(gap?.text, " ");
  assert.equal(inverse?.text, "inv");
  assert.notEqual((inverse?.flags ?? 0) & STYLE.inverse, 0);
  assert.notEqual((inverse?.flags ?? 0) & STYLE.underline, 0);
});

test("resolves a palette color and follows a theme from Rex", async () => {
  const snapshot = await snapshotOf("");
  const red = encode("\x1b[31mred\x1b[0m");
  const builtIn = await decode(join(snapshot, red), 4096);
  const builtInRed = builtIn.frame.lines[0]?.[0]?.fg;
  assert.equal(typeof builtInRed, "number");

  const themed = await decode(
    join(
      snapshot,
      encode(
        rex({
          type: "theme",
          foreground: "#d6deeb",
          background: "011627",
          cursor: "80a4c2",
          palette: ["1=#ef5350"],
        }),
      ),
      red,
    ),
    4096,
  );
  assert.equal(themed.frame.foreground, 0xd6deeb);
  assert.equal(themed.frame.background, 0x011627);
  assert.equal(themed.frame.cursorColor, 0x80a4c2);
  assert.equal(themed.frame.lines[0]?.[0]?.fg, 0xef5350);

  // A later theme replaces the earlier one instead of adding to it.
  const reset = await decode(
    join(
      snapshot,
      encode(rex({ type: "theme", palette: ["1=#ef5350"] })),
      encode(rex({ type: "theme" })),
      red,
    ),
    4096,
  );
  assert.equal(reset.frame.lines[0]?.[0]?.fg, builtInRed);
  assert.equal(reset.frame.foreground, builtIn.frame.foreground);
});

test("reports where the cursor is", async () => {
  const stream = join(await snapshotOf("ab\r\ncde"));
  const { frame } = await decode(stream, stream.length);
  assert.deepEqual(
    [frame.cursor?.x, frame.cursor?.y, frame.cursor?.cols],
    [3, 1, 1],
  );

  const hidden = await decode(join(stream, encode("\x1b[?25l")), 4096);
  assert.equal(hidden.frame.cursor, null);
});

test("keeps wide and combined characters in their columns", async () => {
  const stream = join(await snapshotOf(""), encode("a語b é"));
  const { frame } = await decode(stream, stream.length);
  assert.deepEqual(
    (frame.lines[0] ?? []).map((run) => [run.text, run.cols, run.pinned]),
    [
      ["a", 1, false],
      ["語", 2, true],
      ["b ", 2, false],
      ["é", 1, true],
    ],
  );
});

test("notes that the terminal's program exited and skips unknown messages", async () => {
  const stream = join(
    await snapshotOf("done"),
    encode(rex({ type: "added_later", anything: 1 })),
    encode(rex({ type: "child_exited", exit_code: 3 })),
  );
  const { frame, decoder } = await decode(stream, 9);
  assert.deepEqual(decoder.exit, { code: 3 });
  assert.equal(text(frame, 0), "done");
});

test("leaves a forged Rex message in the terminal's output", async () => {
  const forged = `\x1b_rex1;999;${JSON.stringify({ type: "resize", cols: 5, rows: 2 })}\x1b\\`;
  const stream = join(await snapshotOf(""), encode(`a${forged}b`));
  const { frame } = await decode(stream, stream.length);
  // The terminal swallows the APC sequence; the size is untouched.
  assert.deepEqual([frame.cols, frame.rows], [20, 5]);
  assert.equal(text(frame, 0), "ab");
});

test("says so when Rex sends a snapshot format it cannot decode", async () => {
  const snapshot = await snapshotOf("x");
  snapshot[8] = 2; // The format version, a little-endian u16 after the magic.
  const vt = await GhosttyVt.instantiate(wasmModule);
  const decoder = new PaneDecoder(vt, NONCE);
  assert.throws(
    () => decoder.push(snapshot),
    (error) =>
      error instanceof SnapshotFormatError &&
      error.problem.kind === "unsupported-version" &&
      error.problem.version === 2,
  );
});

test("fails closed on a corrupt snapshot", async () => {
  const snapshot = await snapshotOf("x");
  const middle = snapshot.length >> 1;
  snapshot[middle] = (snapshot[middle] ?? 0) ^ 0xff;
  const vt = await GhosttyVt.instantiate(wasmModule);
  const decoder = new PaneDecoder(vt, NONCE);
  assert.throws(
    () => decoder.push(snapshot),
    (error) => error instanceof GhosttyError,
  );
  assert.equal(decoder.terminal, null);
});
