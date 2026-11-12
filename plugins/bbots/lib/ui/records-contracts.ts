import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema, nameSchema } from "../storage/schema.ts";
import { memoryId, kind } from "../memory/contracts.ts";
import { checkpointId, headerSchema } from "../checkpoints/contracts.ts";

const identity = { threadId: idSchema, botId: idSchema, name: nameSchema };
const note = {
  id: memoryId,
  revision: z.number().int().positive(),
  kind,
  topic: z.string().min(1).max(128),
  basis: z.enum(["fact", "inference"]),
  sources: z.array(z.string().max(320)).max(20),
  sourceCount: z.number().int().nonnegative(),
};
export const recordsContract = defineRpcContract({
  botRecords: {
    input: z.strictObject({
      threadId: idSchema,
      kind: kind.default("knowledge"),
      query: z.string().max(256).default(""),
      memoryAfter: memoryId.optional(),
      checkpointAfter: checkpointId.optional(),
    }),
    output: z.strictObject({
      ...identity,
      memory: z.strictObject({
        items: z
          .array(z.strictObject({ ...note, excerpt: z.string().max(512) }))
          .max(10),
        nextCursor: memoryId.nullable(),
      }),
      checkpoints: z.strictObject({
        items: z.array(headerSchema).max(10),
        nextCursor: checkpointId.nullable(),
      }),
    }),
    tags: () => ["bots"],
  },
  botMemory: {
    input: z.strictObject({ threadId: idSchema, id: memoryId }),
    output: z.discriminatedUnion("availability", [
      z.strictObject({
        ...identity,
        id: memoryId,
        availability: z.literal("suppressed"),
      }),
      z.strictObject({
        ...identity,
        availability: z.literal("available"),
        note: z.strictObject({ ...note, markdown: z.string().max(8192) }),
      }),
    ]),
    tags: () => ["bots"],
  },
});
