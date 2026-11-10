// The relay against real sockets: a small WebSocket server on a Unix socket
// stands in for Rex, so pausing, resuming and closing are the `ws` library's
// own and not a double's idea of them.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { WebSocketServer, type WebSocket } from "ws";

import { openRexSocket, RexControl } from "./rex-control.ts";
import { relay } from "./rex-pane.ts";

const CHUNK_BYTES = 512 * 1024;
/** Many times what the relay will queue, as a large snapshot is. */
const CHUNKS = 48;
const WAIT_MS = 10_000;

function welcome(nonce: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 0x81;
  new DataView(bytes.buffer).setBigUint64(24, nonce, true);
  return bytes;
}

/** Waits until `ready` says so, looking every few milliseconds. */
async function until(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!ready()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * A stand-in Rex server. Its control endpoint answers the hello. Its data
 * endpoint answers the handshake and then sends `CHUNKS` chunks at once,
 * each filled with its own number.
 */
async function startServer() {
  const directory = mkdtempSync(join(tmpdir(), "rex-relay-"));
  const socketPath = join(directory, "s");
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  const seen: { data: WebSocket | null; dataClosed: number | null } = {
    data: null,
    dataClosed: null,
  };
  let controlOpen = 0;
  server.on("connection", (socket, request) => {
    if (request.url === "/api/control") {
      controlOpen += 1;
      socket.on("close", () => {
        controlOpen -= 1;
      });
      socket.once("message", () =>
        socket.send(
          JSON.stringify({ type: "welcome", protocol: "rex.control.v1" }),
        ),
      );
      return;
    }
    seen.data = socket;
    socket.on("close", (code) => {
      seen.dataClosed = code;
    });
    socket.once("message", () => {
      socket.send(welcome(42n));
      for (let index = 0; index < CHUNKS; index++) {
        socket.send(new Uint8Array(CHUNK_BYTES).fill(index));
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(socketPath, resolve));
  return {
    socketPath,
    seen,
    controlOpen: () => controlOpen,
    stop: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => http.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Opens the relay to the stand-in server, as `openPane` does to Rex. */
async function openRelay(socketPath: string) {
  const control = await RexControl.connect(socketPath);
  const data = await openRexSocket(
    socketPath,
    "/api/data",
    "rex.data.terminal.v1",
  );
  const stream = await relay({
    control,
    data,
    hello: new Uint8Array(17).fill(1),
  });
  return { data, stream };
}

test("stops reading from Rex while the viewer is behind, and loses nothing", async () => {
  const server = await startServer();
  try {
    const { data, stream } = await openRelay(server.socketPath);
    assert.equal(stream.nonce, "42");

    // Nobody is reading: the relay pauses the socket instead of holding the
    // whole snapshot, and the rest waits on the server's side.
    await until(() => data.isPaused, "the relay to pause the socket");
    await until(
      () => (server.seen.data?.bufferedAmount ?? 0) > 0,
      "the server to be left holding the rest",
    );
    assert.equal(server.seen.dataClosed, null, "the stream is still open");

    // A viewer that reads gets every byte of every chunk, in order.
    const reader = stream.body.getReader();
    const counted = Array.from({ length: CHUNKS }, () => 0);
    let received = 0;
    let last = 0;
    while (received < CHUNKS * CHUNK_BYTES) {
      const { done, value } = await reader.read();
      assert.equal(done, false, `ended after ${received} bytes`);
      if (value === undefined) continue;
      for (const number of value) {
        if (number !== last) {
          assert.ok(number > last, `chunk ${number} after chunk ${last}`);
          last = number;
        }
        counted[number] = (counted[number] ?? 0) + 1;
      }
      received += value.length;
    }
    // A chunk repeated in place of another would leave the total right and
    // these counts wrong.
    assert.deepEqual(
      counted,
      Array.from({ length: CHUNKS }, () => CHUNK_BYTES),
    );
    assert.equal(data.isPaused, false, "reading resumed");
    await reader.cancel();
  } finally {
    await server.stop();
  }
});

test("ends the stream on Rex when the viewer leaves while reading is paused", async () => {
  const server = await startServer();
  try {
    const { data, stream } = await openRelay(server.socketPath);
    await until(() => data.isPaused, "the relay to pause the socket");

    await stream.body.cancel();
    await stream.closed;
    // A normal close, which tells Rex the stream is over and not to be kept
    // for a resume, and the control connection goes with it.
    await until(() => server.seen.dataClosed !== null, "the data close");
    assert.equal(server.seen.dataClosed, 1000);
    await until(() => server.controlOpen() === 0, "the control close");
  } finally {
    await server.stop();
  }
});

test("ends the stream for the viewer when Rex closes it", async () => {
  const server = await startServer();
  try {
    const { stream } = await openRelay(server.socketPath);
    const reader = stream.body.getReader();
    await reader.read();
    server.seen.data?.close(1001);
    // Whatever was already on its way is delivered, then the stream ends.
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await stream.closed;
    await until(() => server.controlOpen() === 0, "the control close");
  } finally {
    await server.stop();
  }
});
