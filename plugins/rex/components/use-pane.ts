// Fetches the pane's stream from the plugin's backend and keeps a frame of
// what the terminal shows.

import { useEffect, useState } from "react";

import type { Frame, FrameReader } from "../lib/frame-reader.ts";
import { GhosttyVt } from "../lib/ghostty.ts";
import { PaneDecoder } from "../lib/pane-decoder.ts";
import { PANE_HEADERS, paneErrorBodySchema } from "../lib/pane-error.ts";

const HTTP_BASE = "/api/v1/plugins/rex/http";

export type PaneState =
  | { phase: "connecting" }
  | { phase: "failed"; message: string }
  | {
      phase: "open";
      sessionLabel: string;
      /** Whether opening the tab created the session. */
      created: boolean;
      /** Null until the snapshot that opens the stream has arrived. */
      frame: Frame | null;
      /** False once the stream has ended; the last frame stays. */
      live: boolean;
      /** Set once the terminal's program has exited. */
      exit: { code: number | null } | null;
    };

// Compiled once per page and shared; each pane instantiates its own copy.
let compiled: Promise<WebAssembly.Module> | null = null;

function compileGhostty(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(
    fetch(`${HTTP_BASE}/ghostty-vt.wasm`),
  ).catch((error: unknown) => {
    compiled = null;
    throw error;
  });
  return compiled;
}

async function failureMessage(response: Response): Promise<string> {
  const body = paneErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return body.success
    ? body.data.error.message
    : `The Rex stream request failed with HTTP ${response.status}.`;
}

/** Runs until the stream ends or `signal` aborts. Throws on any failure. */
async function watchPane(
  signal: AbortSignal,
  publish: (state: PaneState) => void,
): Promise<void> {
  const [module, response] = await Promise.all([
    compileGhostty(),
    fetch(`${HTTP_BASE}/stream`, { signal, cache: "no-store" }),
  ]);
  if (!response.ok) throw new Error(await failureMessage(response));
  const nonce = response.headers.get(PANE_HEADERS.nonce);
  if (nonce === null || response.body === null) {
    throw new Error("The Rex stream response is missing its channel nonce.");
  }
  const pane = {
    sessionLabel: decodeURIComponent(
      response.headers.get(PANE_HEADERS.sessionLabel) ?? "",
    ),
    created: response.headers.get(PANE_HEADERS.created) === "true",
  };

  const vt = await GhosttyVt.instantiate(module);
  const decoder = new PaneDecoder(vt, nonce);
  let frames: FrameReader | null = null;
  const draw = (live: boolean) => {
    if (decoder.terminal !== null)
      frames ??= vt.newFrameReader(decoder.terminal);
    publish({
      phase: "open",
      ...pane,
      frame: frames?.read() ?? null,
      live,
      exit: decoder.exit,
    });
  };

  // Output can arrive far faster than the screen refreshes. Every chunk is
  // applied to the terminal at once, and a frame is read at most once per
  // repaint.
  let scheduled = 0;
  const body = response.body.getReader();
  draw(true);
  try {
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      decoder.push(value);
      if (scheduled === 0) {
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          draw(true);
        });
      }
    }
    cancelAnimationFrame(scheduled);
    draw(false);
  } finally {
    cancelAnimationFrame(scheduled);
    // Ends the relay on the server when decoding failed part-way.
    void body.cancel().catch(() => {});
  }
}

/** Opens the pane. Change `attempt` to open it again. */
export function usePane(attempt: number): PaneState {
  const [state, setState] = useState<PaneState>({ phase: "connecting" });

  useEffect(() => {
    const abort = new AbortController();
    setState({ phase: "connecting" });
    watchPane(abort.signal, (next) => {
      if (!abort.signal.aborted) setState(next);
    }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      setState({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      // Whatever failed, the stream request may be open or still on its way,
      // such as when the WASM would not load. End it, so the backend does
      // not keep relaying a terminal that nothing is drawing.
      abort.abort();
    });
    return () => abort.abort();
  }, [attempt]);

  return state;
}
