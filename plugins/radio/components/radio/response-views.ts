import { z } from "zod";
export const responseEventSchema = z.object({
  stationId: z.string(),
  id: z.string(),
  cursor: z.number().int().nonnegative(),
  txId: z.string(),
  targetId: z.string(),
  actorId: z.string(),
  sessionId: z.string().nullable(),
  kind: z.enum(["received", "ack", "standby", "squelch"]),
  payload: z.object({
    endpointId: z.string().optional(),
    evidence: z.literal("recipient-confirmation").optional(),
    reason: z.string().optional(),
  }),
  createdAt: z.string(),
});
