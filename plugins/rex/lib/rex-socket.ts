// Where the local Rex server listens.
//
// `rex server status` is the documented way to learn the address. It runs on
// the bb server, which is the only machine this plugin looks for Rex on.

import { execFile } from "node:child_process";

import { z } from "zod";

import { PaneError } from "./pane-error.ts";

const STATUS_TIMEOUT_MS = 10_000;

const statusSchema = z.object({ endpoint: z.string() });

/** The Unix socket path in a `unix://` endpoint, which is percent-encoded. */
export function socketPathFromEndpoint(endpoint: string): string {
  if (!endpoint.startsWith("unix:///")) {
    throw new PaneError(
      "rex_unreachable",
      `The local Rex server listens on ${endpoint}, and this plugin connects only to a Unix socket.`,
    );
  }
  return decodeURIComponent(new URL(endpoint).pathname);
}

/** Asks the `rex` CLI where the local server listens, without starting one. */
export function findRexSocket(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "rex",
      ["server", "status", "--json", "--autostart=false"],
      { timeout: STATUS_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error !== null) {
          const detail =
            "code" in error && error.code === "ENOENT"
              ? "The rex command is not on the bb server's PATH."
              : `rex server status failed: ${stderr.trim() || error.message}`;
          reject(new PaneError("rex_unreachable", detail));
          return;
        }
        try {
          const status = statusSchema.parse(JSON.parse(stdout));
          resolve(socketPathFromEndpoint(status.endpoint));
        } catch (cause) {
          reject(
            cause instanceof PaneError
              ? cause
              : new PaneError(
                  "rex_unreachable",
                  "rex server status did not report an endpoint.",
                ),
          );
        }
      },
    );
  });
}
