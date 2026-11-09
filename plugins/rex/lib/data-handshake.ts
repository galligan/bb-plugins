// The binary handshake that opens a Rex data connection.
//
// The client sends a HELLO: `0x01`, then the 16 bytes of a ticket from
// `data.connect`. The server answers with a WELCOME or a REJECT. Integers are
// unsigned and little-endian. See "Handshake Messages" in the Rex API page.

const HELLO = 0x01;
const WELCOME = 0x81;
const REJECT = 0x82;
const TICKET_BYTES = 16;
const WELCOME_BYTES = 32;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Encodes the HELLO for a ticket, which is 16 bytes as unpadded base64url. */
export function encodeDataHello(ticket: string): Uint8Array {
  if (!TICKET_PATTERN.test(ticket)) {
    throw new Error(
      "Rex issued a data ticket that is not 22 base64url characters.",
    );
  }
  const hello = new Uint8Array(1 + TICKET_BYTES);
  hello[0] = HELLO;
  hello.set(Buffer.from(ticket, "base64url"), 1);
  return hello;
}

export type DataHandshakeReply =
  | {
      kind: "welcome";
      /** Marks Rex's own messages in the stream. Decimal, never zero. */
      nonce: string;
    }
  | { kind: "reject"; reason: number };

/**
 * Reads the server's answer to a HELLO.
 *
 * A WELCOME also carries a reconnect token and a resume window. This plugin
 * never resumes a stream, so it does not keep them.
 */
export function parseDataHandshakeReply(bytes: Uint8Array): DataHandshakeReply {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === WELCOME && bytes.length === WELCOME_BYTES) {
    return { kind: "welcome", nonce: view.getBigUint64(24, true).toString() };
  }
  if (bytes[0] === REJECT && bytes.length >= 2) {
    return { kind: "reject", reason: view.getUint8(1) };
  }
  throw new Error(
    `Rex answered the data handshake with ${bytes.length} bytes that are neither a WELCOME nor a REJECT.`,
  );
}

const REJECT_REASONS = new Map([
  [
    0x01,
    "the ticket was unknown, expired, already used, or issued to another user",
  ],
  [0x02, "this client already has a connection to that terminal"],
  [0x03, "the stream isn't available, such as when its block has closed"],
  [0x04, "opening the connection would pass a server limit"],
  [0x05, "the handshake was malformed or late"],
  [0x06, "the Rex server failed"],
  [0x07, "the ticket was issued for a different subprotocol"],
]);

export function describeReject(reason: number): string {
  return REJECT_REASONS.get(reason) ?? `reason 0x${reason.toString(16)}`;
}
