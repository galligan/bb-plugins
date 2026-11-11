import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { attemptPageSchema, triggerAttemptSchema } from "./trigger-attempts.ts";
export const triggerReadContracts = {
  "triggers.log": {
    input: attemptPageSchema,
    output: z.strictObject({
      attempts: z.array(triggerAttemptSchema).max(100),
      next: z
        .strictObject({
          startedAt: z.number().int().nonnegative(),
          runId: idSchema,
        })
        .nullable(),
    }),
  },
};
