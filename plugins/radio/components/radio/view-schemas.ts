import { z } from "zod";
const id = z.string();
const integer = z.number().int().nonnegative();
export const channelSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  parentId: id.nullable(),
});
export const summarySchema = z.object({
  id,
  cursor: integer,
  body: z.string(),
  channelId: id,
  authorId: id,
  sessionId: id.nullable(),
  createdAt: z.string(),
  replyToId: id.nullable(),
  replyForId: id.nullable(),
  requireAck: z.boolean(),
  expectReply: z.boolean(),
});
export const refSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    url: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    label: z.string().optional(),
  }),
  z.object({ kind: z.literal("dispatch"), id, revision: integer.optional() }),
  z.object({ kind: z.enum(["transmission", "participant", "channel"]), id }),
]);
export const transmissionSchema = summarySchema.extend({
  requestMode: z.enum(["discussion", "exclusive"]),
  refs: z.array(refSchema),
  recipientIds: z.array(id),
  audiences: z.array(z.object({ channelId: id, eligibleCount: integer })),
  tags: z.array(z.string()),
});
export const recipientSchema = z.object({
  targetId: id,
  ackAt: z.string().nullable(),
  standbyAt: z.string().nullable(),
  squelchAt: z.string().nullable(),
  receivedEndpoints: integer,
});
export const dispatchSchema = z.object({
  id,
  channelId: id,
  authorId: id,
  revision: integer,
  title: z.string(),
  markdown: z.string(),
  editorId: id,
  createdAt: z.string(),
});
export const dispatchTitleSchema = z.object({
  cursor: integer,
  id,
  revision: integer,
  title: z.string(),
});
export function pageSchema<T extends z.ZodType, C extends z.ZodType>(
  item: T,
  cursor: C,
) {
  return z.object({
    items: z.array(item),
    nextCursor: cursor,
    hasMore: z.boolean(),
  });
}
