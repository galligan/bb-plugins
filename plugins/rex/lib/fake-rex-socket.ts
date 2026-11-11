// Test support: a FakeRex behind a real control connection.
//
// `server.ts` finds Rex by running `rex server status` and dialling the Unix
// socket it reports. This puts both in a temporary directory: a WebSocket
// server that answers control calls from a FakeRex, and a `rex` command that
// reports its socket. Nothing here can reach a real Rex server.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { WebSocketServer } from "ws";
import { z } from "zod";

import type { FakeRex } from "./fake-rex.ts";
import { PaneError } from "./pane-error.ts";

const requestSchema = z.object({
  type: z.literal("request"),
  id: z.string(),
  method: z.string(),
  payload: z.unknown().optional(),
});

export interface FakeRexSocket {
  /** Makes `rex server status` fail, as when no server is running. */
  stopReporting(): void;
  close(): Promise<void>;
}

/**
 * Serves `rex` on a Unix socket and puts a `rex` command that reports it first
 * on `PATH` for this process. Call `close` to restore `PATH` and remove both.
 */
export async function serveFakeRex(rex: FakeRex): Promise<FakeRexSocket> {
  const directory = mkdtempSync(join(tmpdir(), "rex-fake-"));
  const socketPath = join(directory, "s");
  const command = join(directory, "rex");
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  server.on("connection", (socket, request) => {
    if (request.url !== "/api/control") {
      socket.close(1008, "only the control endpoint is faked");
      return;
    }
    // Attachment belongs to the connection, so each socket starts with none.
    const connection = rex.connection();
    socket.once("message", () => {
      socket.send(
        JSON.stringify({ type: "welcome", protocol: "rex.control.v1" }),
      );
      socket.on("message", (data) => {
        const message = requestSchema.safeParse(JSON.parse(String(data)));
        if (!message.success) return;
        const { id, method, payload } = message.data;
        connection.call(method, payload, z.unknown()).then(
          (result) =>
            socket.send(
              JSON.stringify({ type: "response", id, payload: result }),
            ),
          (error: unknown) =>
            socket.send(
              JSON.stringify({
                type: "response",
                id,
                error: {
                  code:
                    (error instanceof PaneError ? error.rexCode : null) ??
                    "internal",
                  message: error instanceof Error ? error.message : "failed",
                },
              }),
            ),
        );
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(socketPath, resolve));

  const report = (script: string) => {
    writeFileSync(command, `#!/bin/sh\n${script}\n`);
    chmodSync(command, 0o755);
  };
  report(
    `printf '%s' '${JSON.stringify({ endpoint: `unix://${socketPath.split("/").map(encodeURIComponent).join("/")}` })}'`,
  );
  process.env.PATH = [directory, process.env.PATH]
    .filter(Boolean)
    .join(delimiter);

  return {
    stopReporting: () => report("echo 'no server is running' >&2\nexit 1"),
    close: async () => {
      // Take out only this fixture's entry. Restoring a snapshot would put
      // back the directory of a fixture that was open then and closed since.
      process.env.PATH = (process.env.PATH ?? "")
        .split(delimiter)
        .filter((entry) => entry !== directory)
        .join(delimiter);
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => http.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
