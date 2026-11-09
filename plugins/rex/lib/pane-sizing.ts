// When the tab may ask Rex to resize the pane it shows.
//
// A Rex terminal takes its size from the client that owns it, so asking for a
// size changes the pane for every other client looking at it. The rule:
//
//   - In a session this plugin created, the tab claims the pane and asks for
//     the size that fits its panel.
//   - In any other session it never asks. The pane keeps the size its owner
//     gave it, and the tab draws that.
//   - While another client owns a pane the tab had claimed, the tab asks for
//     nothing. It remembers the size its panel wants and asks again only if
//     ownership comes back.

import { z } from "zod";

import type { GridSize } from "./pane-input.ts";

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

export class PaneSizing {
  readonly #mayClaim: boolean;
  readonly #clientId: string;
  readonly #request: (size: GridSize) => void;
  #owns = false;
  #wanted: GridSize | null = null;

  /**
   * `mayClaim` is whether the plugin created the pane's session. `request`
   * asks Rex for a size on the connection whose client is `clientId`.
   */
  constructor(options: {
    mayClaim: boolean;
    clientId: string;
    request: (size: GridSize) => void;
  }) {
    this.#mayClaim = options.mayClaim;
    this.#clientId = options.clientId;
    this.#request = options.request;
  }

  /** Whether the tab should measure its panel and report sizes at all. */
  get mayClaim(): boolean {
    return this.#mayClaim;
  }

  /** The pane's owner is now `owner`, or nobody. */
  ownerIs(owner: string | null): void {
    const owned = this.#mayClaim && owner === this.#clientId;
    const regained = owned && !this.#owns;
    this.#owns = owned;
    if (regained && this.#wanted !== null) this.#request(this.#wanted);
  }

  /** The tab's panel has room for `size`. */
  want(size: GridSize): void {
    if (!this.#mayClaim) return;
    this.#wanted = size;
    if (this.#owns) this.#request(size);
  }
}
