import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const statusSchema = z.strictObject({
  pluginId: z.literal("bbots"),
  stage: z.literal("storage"),
  automaticMaintenance: z.literal("disabled"),
  automaticContinuity: z.literal("disabled"),
  limitations: z.array(z.string()).max(8),
});

export const rpcContract = defineRpcContract({
  status: { input: z.strictObject({}), output: statusSchema },
});

export type DevelopmentStatus = z.infer<typeof statusSchema>;
