import { z } from "zod";
import { changeSchema, idSchema } from "../storage/schema.ts";

export const memoryId = z
  .string()
  .refine(
    (value) =>
      value.startsWith("mem_") && z.uuid().safeParse(value.slice(4)).success,
    "Use the stable mem_ ID from remember/capture",
  );
export const sourceId = z
  .string()
  .trim()
  .max(256)
  .regex(
    /^(thread|artifact|task|user):\S+$/,
    "Use an original thread/artifact/task/user source identifier without spaces",
  );
export const captureKind = z.enum(["state", "decision", "summary"]);
export const kind = z.enum(["knowledge", ...captureKind.options]);
const range = z.strictObject({
  streamId: sourceId,
  from: z.number().int().positive(),
  through: z.number().int().positive(),
});
export const boundary = range
  .extend({
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.through >= value.from,
    "Boundary must not run backwards",
  );
const content = {
  topic: z.string().trim().min(1).max(128),
  markdown: z.string().trim().min(1).max(8192),
  basis: z.enum(["fact", "inference"]),
  sources: z.array(sourceId).max(64).default([]),
  parents: z
    .array(
      z.strictObject({
        id: memoryId,
        revision: z.number().int().positive(),
      }),
    )
    .max(16)
    .default([]),
};
const creationBase = changeSchema.extend({
  botId: idSchema,
  requestId: z.uuid(),
  ...content,
});
export const creationSchema = z.discriminatedUnion("kind", [
  creationBase.extend({ kind: z.literal("knowledge") }),
  creationBase.extend({ kind: captureKind, boundary }),
]);
export const correctSchema = changeSchema.extend({
  botId: idSchema,
  id: memoryId,
  expectedRevision: z.number().int().positive(),
  ...content,
});
export const recordSchema = z
  .strictObject({
    requestId: z.uuid(),
    creationHash: z.string().regex(/^[a-f0-9]{64}$/),
    kind,
    ...content,
    sources: z.array(sourceId).min(1).max(128),
    boundary: range.optional(),
  })
  .refine(
    (value) =>
      value.kind === "knowledge"
        ? value.boundary === undefined
        : value.boundary !== undefined &&
          value.boundary.through >= value.boundary.from,
    "Capture records require their original source boundary; knowledge has no progress cursor",
  );
export type RecordBody = z.infer<typeof recordSchema>;
export type Creation = z.infer<typeof creationSchema>;
export type Correction = z.infer<typeof correctSchema>;

export function documentName(id: string) {
  return `MEMORY:${memoryId.parse(id).slice(4)}.json`;
}
