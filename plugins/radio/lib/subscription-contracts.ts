import { z } from "zod";
import { idSchema } from "./contracts.ts";

export const subscriptionMutationSchema = z
  .object({
    channelId: idSchema,
    targetId: idSchema.optional(),
    kind: z.enum(["listen", "mute", "unlisten"]),
  })
  .strict();
export const subscriptionListingSchema = z
  .object({
    targetId: idSchema.optional(),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
