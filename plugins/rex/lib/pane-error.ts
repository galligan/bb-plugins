// Why the stream route could not open a pane, in a form the tab can show.

import { z } from "zod";

export type PaneErrorCode =
  /** The `rex` command or the local Rex server could not be reached. */
  | "rex_unreachable"
  /** More than one session has the configured label. */
  | "ambiguous_label"
  /** The session has no focused terminal to show. */
  | "no_terminal"
  /** Rex answered a request or the data handshake with a refusal. */
  | "rex_refused"
  | "internal";

const STATUS: Record<PaneErrorCode, 409 | 500 | 502 | 503> = {
  rex_unreachable: 503,
  ambiguous_label: 409,
  no_terminal: 409,
  rex_refused: 502,
  internal: 500,
};

export class PaneError extends Error {
  readonly code: PaneErrorCode;

  constructor(code: PaneErrorCode, message: string) {
    super(message);
    this.name = "PaneError";
    this.code = code;
  }

  get status() {
    return STATUS[this.code];
  }

  toBody(): PaneErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/** The JSON body of a failed stream request. */
export const paneErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type PaneErrorBody = z.infer<typeof paneErrorBodySchema>;

/** Response headers that describe the pane a successful stream carries. */
export const PANE_HEADERS = {
  nonce: "x-rex-nonce",
  sessionLabel: "x-rex-session-label",
  created: "x-rex-session-created",
} as const;
