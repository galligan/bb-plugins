// Applies a Rex terminal stream to a libghostty terminal.
//
// The stream opens with a snapshot, which libghostty can only decode whole,
// so bytes are held until the snapshot's own framing says it is complete.
// Everything after it is terminal output with Rex's messages mixed in.

import type { GhosttyVt, Terminal } from "./ghostty.ts";
import { parseRexMessage, RexMessageSplitter } from "./rex-messages.ts";
import { findSnapshotEnd, newSnapshotScan } from "./snapshot.ts";
import { parseTheme } from "./theme.ts";

/** A snapshot grows with scrollback and images. Past this, give up. */
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export class PaneDecoder {
  readonly #vt: GhosttyVt;
  readonly #splitter: RexMessageSplitter;
  readonly #scan = newSnapshotScan();
  #pending = new Uint8Array(64 * 1024);
  #pendingLength = 0;
  #terminal: Terminal | null = null;
  #exit: { code: number | null } | null = null;

  constructor(vt: GhosttyVt, nonce: string) {
    this.#vt = vt;
    this.#splitter = new RexMessageSplitter(nonce);
  }

  /** The terminal, once the snapshot has been decoded. */
  get terminal(): Terminal | null {
    return this.#terminal;
  }

  /** Set once Rex reports that the terminal's program exited. */
  get exit(): { code: number | null } | null {
    return this.#exit;
  }

  /**
   * Applies the next bytes of the stream.
   *
   * Throws `SnapshotFormatError` when the snapshot is in a format this build
   * cannot decode, and `GhosttyError` when libghostty refuses it.
   */
  push(chunk: Uint8Array): void {
    if (this.#terminal !== null) {
      this.#applyLive(this.#terminal, chunk);
      return;
    }
    this.#hold(chunk);
    const received = this.#pending.subarray(0, this.#pendingLength);
    const end = findSnapshotEnd(received, this.#scan);
    if (end === null) return;
    const terminal = this.#vt.decodeSnapshot(received.subarray(0, end));
    this.#terminal = terminal;
    const live = received.slice(end);
    this.#pending = new Uint8Array(0);
    this.#applyLive(terminal, live);
  }

  #hold(chunk: Uint8Array): void {
    const needed = this.#pendingLength + chunk.length;
    if (needed > MAX_SNAPSHOT_BYTES) {
      throw new Error(
        `The terminal's snapshot is larger than ${MAX_SNAPSHOT_BYTES / (1024 * 1024)} MiB.`,
      );
    }
    if (needed > this.#pending.length) {
      const grown = new Uint8Array(Math.max(needed, this.#pending.length * 2));
      grown.set(this.#pending.subarray(0, this.#pendingLength));
      this.#pending = grown;
    }
    this.#pending.set(chunk, this.#pendingLength);
    this.#pendingLength = needed;
  }

  #applyLive(terminal: Terminal, bytes: Uint8Array): void {
    for (const part of this.#splitter.push(bytes)) {
      if (part.kind === "vt") {
        this.#vt.write(terminal, part.bytes);
        continue;
      }
      const message = parseRexMessage(part.json);
      if (message.type === "resize") {
        this.#vt.resize(terminal, {
          cols: message.cols,
          rows: message.rows,
          cellWidthPx: message.cell_width_px ?? 0,
          cellHeightPx: message.cell_height_px ?? 0,
        });
      } else if (message.type === "theme") {
        this.#vt.applyTheme(terminal, parseTheme(message));
      } else if (message.type === "child_exited") {
        this.#exit = { code: message.exit_code ?? null };
      }
    }
  }
}
