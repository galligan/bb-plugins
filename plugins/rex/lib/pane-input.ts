// What the tab sends to the plugin's backend for a pane: keys, pastes, focus
// changes, and the size the panel has room for.
//
// The tab's requests are untrusted input, so the backend parses every batch
// with these schemas before anything reaches Rex.

import { z } from "zod";

/** Events in one request. The tab splits a longer backlog across requests. */
export const MAX_INPUT_BATCH = 64;

/**
 * Characters in one paste. A Rex control message may be at most 1 MiB, and
 * JSON can write one character as six bytes, so this stays well under it.
 */
export const MAX_PASTE_CHARS = 128 * 1024;

const modsSchema = z.string().regex(/^[a-z_+]{0,96}$/);

/** A key as Rex's `block.event` and `client.key` describe one. */
export const rexKeySchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_]{1,32}$/),
  mods: modsSchema,
  consumed_mods: modsSchema,
  text: z.string().max(32),
  unshifted_codepoint: z.number().int().min(0).max(0x10ffff),
  composing: z.literal(false),
  action: z.enum(["press", "repeat"]),
});

export type RexKey = z.infer<typeof rexKeySchema>;

const gridSizeSchema = z.strictObject({
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  cellWidthPx: z.number().int().min(1).max(1000),
  cellHeightPx: z.number().int().min(1).max(1000),
});

export type GridSize = z.infer<typeof gridSizeSchema>;

export const paneInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("key"), key: rexKeySchema }),
  z.strictObject({
    type: z.literal("paste"),
    text: z.string().min(1).max(MAX_PASTE_CHARS),
  }),
  z.strictObject({ type: z.literal("focus"), focused: z.boolean() }),
  z.strictObject({ type: z.literal("resize"), size: gridSizeSchema }),
]);

export type PaneInput = z.infer<typeof paneInputSchema>;

/** The body of `POST /input`. `pane` names the open stream the events are for. */
export const paneInputBatchSchema = z.strictObject({
  pane: z.string().min(1).max(64),
  events: z.array(paneInputSchema).min(1).max(MAX_INPUT_BATCH),
});

export type PaneInputBatch = z.infer<typeof paneInputBatchSchema>;

/**
 * The `event` of the Rex `block.event` call that delivers an input.
 *
 * `block.event` sends straight to the block, so the user's Rex key bindings
 * never see it, and Rex runs these calls in the order they arrive on one
 * connection.
 */
export function blockEventFor(input: Exclude<PaneInput, { type: "resize" }>): {
  type: string;
  payload: unknown;
} {
  if (input.type === "key") return { type: "key", payload: input.key };
  if (input.type === "paste") {
    return { type: "paste", payload: { text: input.text } };
  }
  return {
    type: "focus",
    payload: { action: input.focused ? "in" : "out" },
  };
}
