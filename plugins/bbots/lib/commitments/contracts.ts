import { z } from "zod";
import { changeSchema, idSchema } from "../storage/schema.ts";

const content = z.strictObject({
  requestId: z.uuid(),
  ownerConversationId: idSchema,
  what: z.string().trim().min(1).max(4096),
  evidence: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
});
export const referenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("unlinked"),
    status: z.enum(["open", "closed"]),
  }),
  z.strictObject({
    kind: z.literal("tasks"),
    boardId: idSchema,
    taskId: idSchema,
  }),
  z.strictObject({
    kind: z.literal("markdown"),
    hostId: idSchema,
    path: z.string().min(1).max(4096),
    reference: z.string().trim().min(1).max(512),
  }),
]);
export const commitmentSchema = content.extend({ reference: referenceSchema });
export const addSchema = content
  .extend({
    ...changeSchema.shape,
    botId: idSchema,
    taskId: idSchema.optional(),
    markdownReference: z.string().trim().min(1).max(512).optional(),
  })
  .refine(
    (input) => !(input.taskId && input.markdownReference),
    "Choose one task reference",
  );
export const commitmentIdSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("cmt_") && z.uuid().safeParse(value.slice(4)).success,
    "Use the stable cmt_ commitment ID",
  );
export type Commitment = z.infer<typeof commitmentSchema>;
export type Reference = z.infer<typeof referenceSchema>;
