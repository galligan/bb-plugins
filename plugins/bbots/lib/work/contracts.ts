import { z } from "zod";
import { changeSchema, idSchema, nameSchema } from "../storage/schema.ts";

export const destinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("conversation"), conversationId: idSchema }),
  z.strictObject({ kind: z.literal("thread"), threadId: idSchema }),
]);
const text = z.string().trim().min(1).max(4096);
export const agreementSchema = z.strictObject({
  assignment: text,
  context: z.string().max(4096).default(""),
  sources: z.array(z.string().min(1).max(512)).max(20).default([]),
  reportWhen: text.default(
    "Report completion, material decisions and blockers.",
  ),
  reportTo: destinationSchema,
  reportContent: text.default(
    "Include the result, evidence, uncertainty and next action.",
  ),
  stopWhen: text.default(
    "Stop when the assignment is complete or the user stops it.",
  ),
});
export const workSchema = changeSchema.extend({
  requestId: z.uuid(),
  botId: idSchema,
  title: nameSchema,
  projectId: idSchema,
  environmentId: idSchema,
  parentThreadId: idSchema.optional(),
  parentNotifications: z.enum(["off", "auto"]).default("off"),
  agreement: agreementSchema,
});
export const workerSchema = z.strictObject({
  conversationId: idSchema,
  requestId: z.uuid(),
  request: workSchema,
  phase: z.enum(["planned", "spawning", "bound"]),
  error: z.string().nullable(),
});
export const agreementWriteSchema = changeSchema.extend({
  conversationId: idSchema,
  expectedRevision: z.number().int().positive(),
  agreement: agreementSchema,
});
export type Agreement = z.infer<typeof agreementSchema>;
export type Destination = z.infer<typeof destinationSchema>;
export type Work = z.infer<typeof workSchema>;
export type Worker = z.infer<typeof workerSchema>;
