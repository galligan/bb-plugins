// bb-plugin-rex — the plugin's backend.
//
// The browser cannot reach the Rex server's Unix socket, so this relays for
// it. Three routes, all for the plugin's own tab:
//
//   - `GET /stream` opens the focused terminal of the configured Rex session
//     and answers with its byte stream for as long as the tab reads it
//   - `POST /input` takes the tab's keys, pastes, focus changes and panel size
//     for an open stream and passes them to Rex in order
//   - `GET /ghostty-vt.wasm` serves the vendored libghostty-vt build the tab
//     decodes the stream with
//
// The stream is relayed as it arrives and never interpreted here; app.tsx
// decodes it.

import { readFile } from "node:fs/promises";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { CREATED_SESSIONS_KEY } from "./lib/created-sessions.ts";
import { PANE_HEADERS, PaneError } from "./lib/pane-error.ts";
import { paneInputBatchSchema } from "./lib/pane-input.ts";
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

  const createdSessions = {
    read: () => bb.storage.kv.get<unknown>(CREATED_SESSIONS_KEY),
    write: (sessionIds: string[]) =>
      bb.storage.kv.set(CREATED_SESSIONS_KEY, sessionIds),
  };

  const open = new Map<string, PaneStream>();
  bb.onDispose(() => {
    for (const pane of open.values()) pane.close();
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
      pane = await openPane({
        socketPath: await findRexSocket(),
        label,
        createdSessions,
      });
    } catch (error) {
      const failure = toPaneError(error);
      bb.log.warn(`stream not opened: ${failure.code}: ${failure.message}`);
      return context.json(failure.toBody(), failure.status);
    }

    open.set(pane.id, pane);
    void pane.closed.then(() => open.delete(pane.id));
    // The tab may have gone away while the pane was being opened.
    const { signal } = context.req.raw;
    if (signal.aborted) pane.close();
    else signal.addEventListener("abort", () => pane.close());

    return new Response(pane.body, {
      headers: {
        // Not a type bb's compression middleware touches, and marked so no
        // layer may buffer it: small chunks have to reach the tab at once.
        "content-type": "application/octet-stream",
        "cache-control": "no-store, no-transform",
        [PANE_HEADERS.pane]: pane.id,
        [PANE_HEADERS.nonce]: pane.nonce,
        [PANE_HEADERS.sessionLabel]: encodeURIComponent(pane.sessionLabel),
        [PANE_HEADERS.sizing]: pane.fitsPanel ? "fit" : "follow",
      },
    });
  });

  bb.http.route("POST", "/input", async (context) => {
    try {
      const batch = paneInputBatchSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!batch.success) {
        throw new PaneError(
          "bad_input",
          "The input is not in a shape the plugin accepts.",
        );
      }
      const pane = open.get(batch.data.pane);
      if (pane === undefined) {
        throw new PaneError(
          "pane_closed",
          "The terminal stream this input is for has ended.",
        );
      }
      await pane.input(batch.data.events);
      return context.body(null, 204);
    } catch (error) {
      const failure = toPaneError(error);
      return context.json(failure.toBody(), failure.status);
    }
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
