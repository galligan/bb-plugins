import { z } from "zod";
import { idSchema } from "./contracts.ts";

export const localContextSchema = z
  .object({
    threadId: idSchema.optional(),
    projectId: idSchema.optional(),
    asUser: z.boolean().default(false),
    operatorCredential: z.string().min(1).max(1024).optional(),
  })
  .strict();
