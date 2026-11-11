import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../storage/schema.ts";
import { viewSchema } from "../setup/contracts.ts";

export const ownershipSchema = z.record(
  idSchema,
  z
    .strictObject({
      botId: idSchema,
      name: z.string(),
      role: z.enum(["main", "worker"]),
    })
    .nullable(),
);
export type Ownership = z.infer<typeof ownershipSchema>;
export const uiContract = defineRpcContract({
  taskSource: {
    input: z.strictObject({ botId: idSchema }),
    output: z.strictObject({
      kind: z.enum(["unconfigured", "tasks", "markdown"]),
      availability: z.enum([
        "unconfigured",
        "available",
        "unavailable",
        "recovery-required",
      ]),
      boardId: idSchema.nullable(),
      file: z
        .strictObject({ hostId: idSchema, path: z.string().min(1).max(4096) })
        .nullable(),
    }),
    tags: () => ["bots"],
  },
  ownership: {
    input: z.strictObject({ keys: z.array(idSchema).max(200) }),
    output: ownershipSchema,
    tags: () => ["bots"],
  },
  creation: {
    input: z.strictObject({ requestId: z.uuid() }),
    output: viewSchema.nullable(),
    tags: () => ["bots"],
  },
});
