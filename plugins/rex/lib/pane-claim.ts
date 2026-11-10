// When the tab may change the pane it shows: its size and its colors.
//
// A Rex terminal takes its size and its default colors from the client that
// owns it, so asking for either changes the pane for every other client
// looking at it. The rule:
//
//   - In a window this plugin created, the tab claims the pane, asks for the
//     size that fits its panel, and gives it the app's terminal colors.
//   - In any other window it never asks. The pane keeps what its owner gave
//     it. The tab draws that size, and draws in the app's colors regardless.
//   - While another client owns a pane the tab had claimed, the tab asks for
//     nothing. It remembers what it wants and asks again only if ownership
//     comes back.

import { z } from "zod";

import type { GridSize, TerminalTheme } from "./pane-input.ts";

const ownerChangeSchema = z.object({
  type: z.literal("event"),
  payload: z.object({
    type: z.literal("session_event"),
    payload: z.object({
      session_id: z.string(),
      event: z.object({
        type: z.literal("block_owner_changed"),
        payload: z.object({
          block_id: z.string(),
          owner: z.string().optional(),
        }),
      }),
    }),
  }),
});

/**
 * Reads a control message. Returns the pane's new owner when the message says
 * the owner of this block changed, with null for no owner, and undefined for
 * every other message.
 */
export function ownerChange(
  message: unknown,
  pane: { sessionId: string; blockId: string },
): string | null | undefined {
  const parsed = ownerChangeSchema.safeParse(message);
  if (!parsed.success) return undefined;
  const { session_id, event } = parsed.data.payload.payload;
  if (
    session_id !== pane.sessionId ||
    event.payload.block_id !== pane.blockId
  ) {
    return undefined;
  }
  return event.payload.owner ?? null;
}

export class PaneClaim {
  readonly #mayClaim: boolean;
  readonly #clientId: string;
  readonly #resize: (size: GridSize) => void;
  readonly #recolor: (theme: TerminalTheme) => void;
  #owns = false;
  #size: GridSize | null = null;
  #theme: TerminalTheme | null = null;

  /**
   * `mayClaim` is whether the plugin created the pane's window. `resize` and
   * `recolor` ask Rex on the connection whose client is `clientId`.
   */
  constructor(options: {
    mayClaim: boolean;
    clientId: string;
    resize: (size: GridSize) => void;
    recolor: (theme: TerminalTheme) => void;
  }) {
    this.#mayClaim = options.mayClaim;
    this.#clientId = options.clientId;
    this.#resize = options.resize;
    this.#recolor = options.recolor;
  }

  /** Whether the tab should report its panel's size and the app's colors. */
  get mayClaim(): boolean {
    return this.#mayClaim;
  }

  /** The pane's owner is now `owner`, or nobody. */
  ownerIs(owner: string | null): void {
    const owned = this.#mayClaim && owner === this.#clientId;
    const regained = owned && !this.#owns;
    this.#owns = owned;
    if (!regained) return;
    if (this.#size !== null) this.#resize(this.#size);
    if (this.#theme !== null) this.#recolor(this.#theme);
  }

  /** The tab's panel has room for `size`. */
  wantSize(size: GridSize): void {
    if (!this.#mayClaim) return;
    this.#size = size;
    if (this.#owns) this.#resize(size);
  }

  /** The app's terminal colors are now `theme`. */
  wantTheme(theme: TerminalTheme): void {
    if (!this.#mayClaim) return;
    this.#theme = theme;
    if (this.#owns) this.#recolor(theme);
  }
}
