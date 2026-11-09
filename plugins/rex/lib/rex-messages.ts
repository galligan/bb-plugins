// Rex's own messages in a terminal stream.
//
// After the snapshot, the stream is the terminal program's output with Rex's
// messages placed in it as APC sequences: `ESC _ rex1;<nonce>;<json> ESC \`.
// `<nonce>` is the data connection's channel nonce in decimal. A look-alike
// with another nonce was printed by a program, so it stays terminal output.

import { z } from "zod";

const ESC = 0x1b;
const TERMINATOR = Uint8Array.from([ESC, 0x5c]); // ESC \

export type StreamPart =
  { kind: "vt"; bytes: Uint8Array } | { kind: "message"; json: unknown };

/**
 * Splits live stream bytes into terminal output and Rex messages.
 *
 * Chunk boundaries have no meaning, so a message cut by one is held until the
 * rest arrives.
 */
export class RexMessageSplitter {
  readonly #prefix: Uint8Array;
  #held: Uint8Array = new Uint8Array(0);

  constructor(nonce: string) {
    this.#prefix = new TextEncoder().encode(`\x1b_rex1;${nonce};`);
  }

  /** Returns the parts of `chunk`, joined to any held bytes, in stream order. */
  push(chunk: Uint8Array): StreamPart[] {
    const bytes = this.#held.length > 0 ? concat(this.#held, chunk) : chunk;
    this.#held = new Uint8Array(0);
    const parts: StreamPart[] = [];
    let position = 0;
    while (position < bytes.length) {
      const start = indexOfBytes(bytes, this.#prefix, position);
      if (start === -1) {
        const end = bytes.length - this.#partialPrefixBytes(bytes, position);
        if (end > position) {
          parts.push({ kind: "vt", bytes: bytes.subarray(position, end) });
        }
        this.#held = bytes.slice(end);
        return parts;
      }
      if (start > position) {
        parts.push({ kind: "vt", bytes: bytes.subarray(position, start) });
      }
      const jsonStart = start + this.#prefix.length;
      const jsonEnd = indexOfBytes(bytes, TERMINATOR, jsonStart);
      if (jsonEnd === -1) {
        this.#held = bytes.slice(start);
        return parts;
      }
      parts.push({
        kind: "message",
        json: parseJson(bytes.subarray(jsonStart, jsonEnd)),
      });
      position = jsonEnd + TERMINATOR.length;
    }
    return parts;
  }

  /** How many bytes at the end of `bytes` could be the start of the prefix. */
  #partialPrefixBytes(bytes: Uint8Array, from: number): number {
    const longest = Math.min(this.#prefix.length - 1, bytes.length - from);
    for (let count = longest; count > 0; count--) {
      const tailStart = bytes.length - count;
      let matches = true;
      for (let index = 0; index < count; index++) {
        if (bytes[tailStart + index] !== this.#prefix[index]) {
          matches = false;
          break;
        }
      }
      if (matches) return count;
    }
    return 0;
  }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  const first = needle[0];
  if (first === undefined) return from;
  const last = haystack.length - needle.length;
  for (
    let index = haystack.indexOf(first, from);
    index !== -1 && index <= last;
    index = haystack.indexOf(first, index + 1)
  ) {
    let matches = true;
    for (let offset = 1; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

/** A message whose JSON does not parse is passed on as one with no type. */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const rexMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().min(1).max(65535),
    rows: z.number().int().min(1).max(65535),
    cell_width_px: z.number().int().min(0).optional(),
    cell_height_px: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("theme"),
    foreground: z.string().optional(),
    background: z.string().optional(),
    cursor: z.string().optional(),
    palette: z.array(z.string()).nullish(),
  }),
  z.object({
    type: z.literal("child_exited"),
    exit_code: z.number().int().optional(),
  }),
]);

export type RexMessage = z.infer<typeof rexMessageSchema> | { type: "unknown" };

/**
 * Reads one Rex message. The protocol asks clients to skip a type they do
 * not know, so anything unrecognised comes back as `unknown`.
 */
export function parseRexMessage(json: unknown): RexMessage {
  const parsed = rexMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : { type: "unknown" };
}
