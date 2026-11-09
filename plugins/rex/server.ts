// bb-plugin-rex — the plugin's backend.
//
// The browser cannot reach the Rex server's Unix socket, so this relays for
// it. Two routes, both for the plugin's own tab:
//
//   - `GET /stream` opens the focused terminal of the configured Rex session
//     and answers with its byte stream for as long as the tab reads it
//   - `GET /ghostty-vt.wasm` serves the vendored libghostty-vt build the tab
//     decodes that stream with
//
// The stream is relayed as it arrives and never interpreted here; app.tsx
// decodes it.

import { readFile } from "node:fs/promises";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { PANE_HEADERS, PaneError } from "./lib/pane-error.ts";
import { openPane, type PaneStream } from "./lib/rex-pane.ts";
import { findRexSocket } from "./lib/rex-socket.ts";

// Path installs load this file as it is. Managed installs load the bundle in
// dist/, one directory further from the vendored file.
const WASM_LOCATIONS = [
  new URL("./vendor/ghostty-vt.wasm", import.meta.url),
  new URL("../vendor/ghostty-vt.wasm", import.meta.url),
];

async function readWasm(): Promise<Uint8Array<ArrayBuffer>> {
  for (const location of WASM_LOCATIONS) {
    try {
      return new Uint8Array(await readFile(location));
    } catch {
      // Try the next location.
    }
  }
  throw new Error("vendor/ghostty-vt.wasm is missing from the plugin.");
}

function toPaneError(error: unknown): PaneError {
  if (error instanceof PaneError) return error;
  return new PaneError(
    "internal",
    error instanceof Error ? error.message : String(error),
  );
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    sessionLabel: {
      type: "string",
      label: "Rex session label",
      description:
        "The Rex tab shows the session with this label, and creates it with one shell if no session has it. Set it to an existing session's label, such as main, to show that session.",
      default: "bb",
    },
  });

  const open = new Set<PaneStream>();
  bb.onDispose(() => {
    for (const pane of open) pane.close();
  });

  bb.http.route("GET", "/stream", async (context) => {
    let pane: PaneStream;
    try {
      const { sessionLabel } = await settings.get();
      const label = sessionLabel.trim();
      if (label === "") {
        throw new PaneError(
          "no_terminal",
          "The plugin's Rex session label setting is empty.",
        );
      }
      pane = await openPane({ socketPath: await findRexSocket(), label });
    } catch (error) {
      const failure = toPaneError(error);
      bb.log.warn(`stream not opened: ${failure.code}: ${failure.message}`);
      return context.json(failure.toBody(), failure.status);
    }

    open.add(pane);
    void pane.closed.then(() => open.delete(pane));
    context.req.raw.signal.addEventListener("abort", () => pane.close());

    return new Response(pane.body, {
      headers: {
        // Not a type bb's compression middleware touches, and marked so no
        // layer may buffer it: small chunks have to reach the tab at once.
        "content-type": "application/octet-stream",
        "cache-control": "no-store, no-transform",
        [PANE_HEADERS.nonce]: pane.nonce,
        [PANE_HEADERS.sessionLabel]: encodeURIComponent(pane.sessionLabel),
        [PANE_HEADERS.created]: String(pane.created),
      },
    });
  });

  bb.http.route("GET", "/ghostty-vt.wasm", async () => {
    return new Response(await readWasm(), {
      headers: {
        "content-type": "application/wasm",
        "cache-control": "no-cache",
      },
    });
  });
}
