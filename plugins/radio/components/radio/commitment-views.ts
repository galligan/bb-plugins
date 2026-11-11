import { z } from "zod";
export const commitmentSchema = z.object({
  id: z.string(),
  cursor: z.number(),
  txId: z.string(),
  targetId: z.string(),
  ownerActorId: z.string(),
  openingSessionId: z.string().nullable(),
  generation: z.number().int().nonnegative(),
  status: z.enum(["open", "done", "abandoned"]),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  result: z.string().nullable(),
  reason: z.string().nullable(),
});
export const commitmentEventSchema = z.object({
  stationId: z.string(),
  id: z.string(),
  cursor: z.number().int().nonnegative(),
  txId: z.string(),
  commitmentId: z.string(),
  actorId: z.string(),
  sessionId: z.string().nullable(),
  kind: z.enum(["wilco", "done", "abandon", "reopen"]),
  payload: z.object({ generation: z.number().int().nonnegative() }),
  createdAt: z.string(),
});
export type CommitmentView = z.infer<typeof commitmentSchema>;
