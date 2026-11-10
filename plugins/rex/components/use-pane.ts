// Fetches the pane's stream from the plugin's backend, keeps a frame of what
// the terminal shows, and sends the pane its input.

import { useEffect, useState } from "react";

import type { Frame } from "../lib/frame-reader.ts";
import { GhosttyVt, type ScrollTo } from "../lib/ghostty.ts";
import { InputQueue } from "../lib/input-queue.ts";
import { PaneDecoder } from "../lib/pane-decoder.ts";
import { PANE_HEADERS, paneErrorBodySchema } from "../lib/pane-error.ts";
import {
  MAX_INPUT_BATCH,
  MAX_PASTE_CHARS,
  type PaneInput,
} from "../lib/pane-input.ts";

const HTTP_BASE = "/api/v1/plugins/rex/http";

export type PaneState =
  | { phase: "connecting" }
  | { phase: "failed"; message: string }
  | {
      phase: "open";
      sessionLabel: string;
      /** The label of the thread's window in Rex. */
      windowLabel: string;
      /** Whether the tab fits the pane to its panel and gives it bb's colors. */
      claimsPane: boolean;
      /** Null until the snapshot that opens the stream has arrived. */
      frame: Frame | null;
      /** False once the stream has ended; the last frame stays. */
      live: boolean;
      /** Set once the terminal's program has exited. */
      exit: { code: number | null } | null;
      /** Why the latest input did not reach the terminal, if it did not. */
      inputProblem: string | null;
      /** Why older history stopped being restored early, if it did. */
      historyProblem: string | null;
      /** Sends input to the pane. Input is delivered in the order sent. */
      send: (input: PaneInput) => void;
      /**
       * Moves the tab's own view through the terminal's history, in the rows
       * `frame.scroll` counts. Nothing is sent to Rex, so no other client's
       * view changes.
       */
      scroll: (to: ScrollTo) => void;
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

async function failureMessage(
  response: Response,
  what: string,
): Promise<string> {
  const body = paneErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return body.success
    ? body.data.error.message
    : `The Rex ${what} request failed with HTTP ${response.status}.`;
}

/** Runs until the stream ends or `signal` aborts. Throws on any failure. */
async function watchPane(
  threadId: string,
  signal: AbortSignal,
  publish: (state: PaneState) => void,
): Promise<void> {
  const [module, response] = await Promise.all([
    compileGhostty(),
    fetch(`${HTTP_BASE}/stream?thread=${encodeURIComponent(threadId)}`, {
      signal,
      cache: "no-store",
    }),
  ]);
  if (!response.ok) throw new Error(await failureMessage(response, "stream"));
  const paneId = response.headers.get(PANE_HEADERS.pane);
  const nonce = response.headers.get(PANE_HEADERS.nonce);
  if (paneId === null || nonce === null || response.body === null) {
    throw new Error("The Rex stream response is missing its pane headers.");
  }
  const pane = {
    sessionLabel: decodeURIComponent(
      response.headers.get(PANE_HEADERS.sessionLabel) ?? "",
    ),
    windowLabel: decodeURIComponent(
      response.headers.get(PANE_HEADERS.windowLabel) ?? "",
    ),
    claimsPane: response.headers.get(PANE_HEADERS.claim) === "claimed",
  };

  const vt = await GhosttyVt.instantiate(module);
  const decoder = new PaneDecoder(vt, nonce);
  let live = true;
  let inputProblem: string | null = null;
  const draw = () => {
    publish({
      phase: "open",
      ...pane,
      frame: decoder.view?.read() ?? null,
      live,
      exit: decoder.exit,
      inputProblem,
      historyProblem: decoder.view?.historyProblem ?? null,
      send,
      scroll,
    });
  };

  // Output can arrive far faster than the screen refreshes, and so can wheel
  // events. Each is applied to the terminal at once, and a frame is read at
  // most once per repaint.
  let scheduled = 0;
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      draw();
    });
  };
  const unschedule = () => {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
  };
  signal.addEventListener("abort", unschedule);

  const scroll = (to: ScrollTo) => {
    decoder.view?.scroll(to);
    schedule();
  };
  const report = (problem: string | null) => {
    if (problem === inputProblem) return;
    inputProblem = problem;
    draw();
  };

  const queue = new InputQueue<PaneInput>({
    maxBatch: MAX_INPUT_BATCH,
    send: async (events) => {
      const reply = await fetch(`${HTTP_BASE}/input`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pane: paneId, events }),
      });
      if (!reply.ok) throw new Error(await failureMessage(reply, "input"));
      report(null);
    },
    onFailure: (error) => {
      if (signal.aborted) return;
      report(error instanceof Error ? error.message : String(error));
    },
  });
  const send = (input: PaneInput) => {
    if (!live) return;
    if (input.type === "paste" && input.text.length > MAX_PASTE_CHARS) {
      report(
        `That paste is too large to send: the limit is ${MAX_PASTE_CHARS / 1024} KiB.`,
      );
      return;
    }
    // Typing brings the view back to the live screen, where it lands.
    if (input.type === "key" || input.type === "paste") {
      scroll({ kind: "bottom" });
    }
    queue.push(input);
  };

  const body = response.body.getReader();
  draw();
  try {
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      decoder.push(value);
      schedule();
    }
    unschedule();
    live = false;
    draw();
  } finally {
    unschedule();
    // Ends the relay on the server when decoding failed part-way.
    void body.cancel().catch(() => {});
  }
}

/** Opens the pane of `threadId`'s window. Change `attempt` to open it again. */
export function usePane(threadId: string, attempt: number): PaneState {
  const [state, setState] = useState<PaneState>({ phase: "connecting" });

  useEffect(() => {
    const abort = new AbortController();
    setState({ phase: "connecting" });
    watchPane(threadId, abort.signal, (next) => {
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
  }, [threadId, attempt]);

  return state;
}
