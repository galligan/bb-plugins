import { z } from "zod";
import { idSchema } from "./contracts.ts";

const key = z.string().min(1).max(128);
const explanation = z.string().trim().min(1).max(400);
export const commitmentActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("wilco"),
      txId: idSchema,
      targetId: idSchema,
      idempotencyKey: key,
    })
    .strict(),
  z
    .object({
      kind: z.literal("done"),
      commitmentId: idSchema,
      result: explanation,
      idempotencyKey: key,
    })
    .strict(),
  z
    .object({
      kind: z.literal("abandon"),
      commitmentId: idSchema,
      reason: explanation,
      idempotencyKey: key,
    })
    .strict(),
  z
    .object({
      kind: z.literal("reopen"),
      txId: idSchema,
      expectedCommitmentId: idSchema,
      idempotencyKey: key,
    })
    .strict(),
]);
export type CommitmentAction = z.infer<typeof commitmentActionSchema>;
export const commitmentListSchema = z
  .object({
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
    status: z.enum(["open", "all"]).default("open"),
  })
  .strict();
export interface Commitment {
  stationId: string;
  id: string;
  cursor: number;
  txId: string;
  targetId: string;
  ownerActorId: string;
  openingSessionId: string | null;
  generation: number;
  status: "open" | "done" | "abandoned";
  openedAt: string;
  closedAt: string | null;
  result: string | null;
  reason: string | null;
}
export interface CommitmentEvent {
  stationId: string;
  id: string;
  cursor: number;
  txId: string;
  commitmentId: string;
  actorId: string;
  sessionId: string | null;
  kind: CommitmentAction["kind"];
  payload: { generation: number };
  createdAt: string;
}
export interface CommitmentOutcome {
  commitment: Commitment;
  event: CommitmentEvent;
}
