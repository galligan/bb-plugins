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
