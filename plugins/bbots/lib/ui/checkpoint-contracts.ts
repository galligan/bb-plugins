import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema, nameSchema, changeSchema } from "../storage/schema.ts";
import { headerSchema } from "../checkpoints/contracts.ts";

export const checkpointRequest = z.strictObject({
  threadId: idSchema,
  expectedBotId: idSchema,
  requestId: z.uuid(),
  name: nameSchema,
  reason: changeSchema.shape.reason,
});
export const checkpointUiContract = defineRpcContract({
  botCheckpointCreate: {
    input: checkpointRequest,
    output: z.strictObject({ checkpoint: headerSchema, replay: z.boolean() }),
  },
});
