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
    socket.once("message", () => {
      socket.send(
        JSON.stringify({ type: "welcome", protocol: "rex.control.v1" }),
      );
      socket.on("message", (data) => {
        const message = requestSchema.safeParse(JSON.parse(String(data)));
        if (!message.success) return;
        const { id, method, payload } = message.data;
        rex.call(method, payload, z.unknown()).then(
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
  const path = process.env.PATH;
  process.env.PATH = [directory, path].filter(Boolean).join(delimiter);

  return {
    stopReporting: () => report("echo 'no server is running' >&2\nexit 1"),
    close: async () => {
      process.env.PATH = path;
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => http.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
