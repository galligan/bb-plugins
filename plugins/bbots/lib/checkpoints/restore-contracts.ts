import { z } from "zod";
import { changeSchema, idSchema } from "../storage/schema.ts";
import { memoryId } from "../memory/contracts.ts";
import { checkpointId } from "./contracts.ts";

const expectedRevision = z.number().int().nonnegative();
export const selectionSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("profile"),
        expectedRevision: expectedRevision.min(1),
      }),
      z.strictObject({ kind: z.literal("soul"), expectedRevision }),
      z.strictObject({ kind: z.literal("execution"), expectedRevision }),
      z.strictObject({
        kind: z.literal("knowledge"),
        id: memoryId,
        expectedRevision: expectedRevision.min(1),
      }),
    ]),
  )
  .min(1)
  .max(20)
  .refine(
    (items) =>
      new Set(items.map((i) => (i.kind === "knowledge" ? i.id : i.kind)))
        .size === items.length,
    "Select each record only once",
  );
export const restoreSchema = changeSchema.extend({
  botId: idSchema,
  checkpointId,
  requestId: z.uuid(),
  selection: selectionSchema,
});
export const receiptSchema = z.strictObject({
  requestId: z.uuid(),
  checkpointId,
  creationHash: z.string().regex(/^[a-f0-9]{64}$/),
  ...changeSchema.shape,
  createdAt: z.string(),
  writes: z
    .array(
      z.strictObject({
        kind: z.enum(["profile", "soul", "execution", "knowledge"]),
        id: idSchema,
        fromRevision: expectedRevision,
        toRevision: expectedRevision.min(1),
      }),
    )
    .min(1)
    .max(20),
});
export type RestoreInput = z.infer<typeof restoreSchema>;
