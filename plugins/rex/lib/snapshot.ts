// Framing of the Ghostty snapshot that opens a Rex terminal stream.
//
// Rex sends no length and no delimiter for the snapshot. It delimits itself:
// a 10-byte envelope (the magic `GHOSTSNP`, then a little-endian u16 format
// version), then records, each a 10-byte header (u16 tag, u32 payload length,
// u32 CRC32C) followed by its payload. The record with tag 6, FINISH, ends
// the snapshot; the next byte is live terminal output.
//
// libghostty reports a version it cannot read with the same generic error as
// a corrupt snapshot, so the envelope is read here to say which it is.

/** The snapshot format version the vendored `ghostty-vt.wasm` decodes. */
export const SNAPSHOT_FORMAT_VERSION = 1;

const MAGIC = new TextEncoder().encode("GHOSTSNP");
const ENVELOPE_BYTES = MAGIC.length + 2;
const RECORD_HEADER_BYTES = 10;
const TAG_FINISH = 6;

export type SnapshotFormatProblem =
  { kind: "not-a-snapshot" } | { kind: "unsupported-version"; version: number };

/** The stream does not open with a snapshot this build can decode. */
export class SnapshotFormatError extends Error {
  readonly problem: SnapshotFormatProblem;

  constructor(problem: SnapshotFormatProblem) {
    super(
      problem.kind === "not-a-snapshot"
        ? "The stream does not start with a Ghostty snapshot."
        : `Rex sent snapshot format version ${problem.version}, and this plugin reads version ${SNAPSHOT_FORMAT_VERSION}. Rex and the plugin are out of step: update whichever is older.`,
    );
    this.name = "SnapshotFormatError";
    this.problem = problem;
  }
}

/** Where a scan stopped, so the next call does not walk a record twice. */
export interface SnapshotScan {
  offset: number;
}

export function newSnapshotScan(): SnapshotScan {
  return { offset: 0 };
}

/**
 * Walks the snapshot's framing over the bytes received so far.
 *
 * Returns the snapshot's total length once its FINISH record is complete, or
 * null when more bytes are needed. Throws `SnapshotFormatError` as soon as
 * the envelope shows the snapshot cannot be decoded.
 */
export function findSnapshotEnd(
  bytes: Uint8Array,
  scan: SnapshotScan,
): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (scan.offset === 0) {
    const known = Math.min(bytes.length, MAGIC.length);
    for (let index = 0; index < known; index++) {
      if (bytes[index] !== MAGIC[index]) {
        throw new SnapshotFormatError({ kind: "not-a-snapshot" });
      }
    }
    if (bytes.length < ENVELOPE_BYTES) return null;
    const version = view.getUint16(MAGIC.length, true);
    if (version !== SNAPSHOT_FORMAT_VERSION) {
      throw new SnapshotFormatError({ kind: "unsupported-version", version });
    }
    scan.offset = ENVELOPE_BYTES;
  }
  while (scan.offset + RECORD_HEADER_BYTES <= bytes.length) {
    const tag = view.getUint16(scan.offset, true);
    const payloadBytes = view.getUint32(scan.offset + 2, true);
    const end = scan.offset + RECORD_HEADER_BYTES + payloadBytes;
    if (end > bytes.length) return null;
    scan.offset = end;
    if (tag === TAG_FINISH) return end;
  }
  return null;
}
