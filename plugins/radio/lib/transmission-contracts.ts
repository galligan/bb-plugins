import { z } from "zod";
import { idSchema, type TrustedCaller } from "./contracts.ts";
import type { AddressScope } from "./address-resolution.ts";
import type { BodyToken } from "./body-parser.ts";
import { RadioError } from "./errors.ts";

export const TX_BODY_MAX = 400;
export const TX_RAW_MAX = 2000;
export const TX_REFS_MAX = 16;
export const TX_RECIPIENTS_MAX = 100;
export const TX_RECIPIENT_INPUT_MAX = 1000;
const referenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("url"),
      url: z.url().max(2048),
      label: z.string().max(120).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("transmission"), id: idSchema }).strict(),
  z.object({ kind: z.literal("participant"), id: idSchema }).strict(),
  z.object({ kind: z.literal("channel"), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal("dispatch"),
      id: idSchema,
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
]);
export type TransmissionRef = z.infer<typeof referenceSchema>;
export const sendSchema = z
  .object({
    channelId: idSchema.optional(),
    ch: z.string().min(1).max(513).optional(),
    body: z.string().min(1).max(TX_RAW_MAX),
    refs: z.array(referenceSchema).max(TX_REFS_MAX).default([]),
    recipientIds: z.array(idSchema).max(TX_RECIPIENT_INPUT_MAX).default([]),
    replyToId: idSchema.optional(),
    idempotencyKey: z.string().min(1).max(128),
    requestMode: z.enum(["discussion", "exclusive"]).default("discussion"),
    requireAck: z.boolean().default(false),
    expectReply: z.boolean().default(false),
    replyForId: idSchema.optional(),
  })
  .strict()
  .refine((input) => Number(!!input.channelId) + Number(!!input.ch) === 1, {
    message: "Choose exactly one canonical channelId or readable ch path.",
  });

/** All fields come from authenticated adapter context, never claimed body metadata. */
export interface TransmissionContext {
  caller: TrustedCaller;
  authorId: string;
  sessionId?: string;
  scope: AddressScope;
}
export interface Transmission {
  requestMode: "discussion" | "exclusive";
  requireAck: boolean;
  expectReply: boolean;
  stationId: string;
  id: string;
  cursor: number;
  authorId: string;
  sessionId: string | null;
  channelId: string;
  body: string;
  createdAt: string;
  replyToId: string | null;
  replyForId: string | null;
  refs: TransmissionRef[];
  tags: string[];
  tokens: (BodyToken & { targetId?: string; stationId?: string })[];
  recipientIds: string[];
  audiences: { channelId: string; eligibleCount: number }[];
}
export const scanSchema = z
  .object({
    channelId: idSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export function parseSend(input: unknown) {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success)
    throw new RadioError(
      "invalid_input",
      `Invalid transmission: ${parsed.error.issues[0]!.message}`,
    );
  const request = parsed.data;
  const length = [...request.body].length;
  if (!request.body.trim() || length > TX_BODY_MAX)
    throw new RadioError(
      "invalid_input",
      `Transmission body has ${length} characters; use 1–${TX_BODY_MAX} characters or move detail to a dispatch/ref. Nothing was truncated.`,
    );
  for (const ref of request.refs) {
    if (ref.kind !== "url") continue;
    const url = new URL(ref.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new RadioError(
        "invalid_input",
        "External refs require an HTTP(S) URL without embedded credentials.",
      );
  }
  request.recipientIds = [...new Set(request.recipientIds)].sort();
  if (request.recipientIds.length > TX_RECIPIENTS_MAX)
    throw new RadioError(
      "invalid_input",
      `Select at most ${TX_RECIPIENTS_MAX} distinct recipients.`,
    );
  return request;
}
