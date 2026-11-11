import { z } from "zod";
import { commitmentSchema, commitmentEventSchema } from "./commitment-views.ts";
import type { CommitmentAction } from "../../lib/commitment-contracts.ts";
import type { ActingIdentity } from "./acting-context.ts";

export const commitmentOutcomeSchema = z.object({
  // Older confirmed recovery records passed exact-session checks and had no flag.
  replayed: z.boolean().default(false),
  commitment: commitmentSchema.extend({ stationId: z.string() }),
  event: commitmentEventSchema,
});
export type CommitmentOutcomeView = z.infer<typeof commitmentOutcomeSchema>;
export interface WorkScope {
  identity: ActingIdentity;
  projectId: string;
  txId: string;
  commitmentId?: string;
}
export function workRecoveryKey(scope: WorkScope) {
  const { identity, projectId, txId, commitmentId } = scope;
  return `radio-work-v1:${JSON.stringify([identity.stationId, projectId, identity.actorId, identity.sessionId, txId, commitmentId ?? null])}`;
}
export function requestMatchesScope(
  scope: WorkScope,
  request: CommitmentAction,
) {
  return request.kind === "done" || request.kind === "abandon"
    ? request.commitmentId === scope.commitmentId
    : !scope.commitmentId && request.txId === scope.txId;
}
export function outcomeMatchesRequest(
  scope: WorkScope,
  request: CommitmentAction,
  outcome: CommitmentOutcomeView,
) {
  const { commitment, event } = outcome;
  const historicalActorWilco =
    request.kind === "wilco" &&
    request.targetId === scope.identity.actorId &&
    outcome.replayed;
  if (
    event.stationId !== scope.identity.stationId ||
    commitment.stationId !== scope.identity.stationId ||
    event.txId !== scope.txId ||
    commitment.txId !== scope.txId ||
    event.commitmentId !== commitment.id ||
    event.actorId !== scope.identity.actorId ||
    (!historicalActorWilco && event.sessionId !== scope.identity.sessionId) ||
    event.kind !== request.kind
  )
    return false;
  switch (request.kind) {
    case "wilco":
      return (
        commitment.targetId === request.targetId &&
        commitment.ownerActorId === scope.identity.actorId &&
        (historicalActorWilco
          ? event.sessionId === commitment.openingSessionId
          : commitment.openingSessionId === scope.identity.sessionId) &&
        commitment.status === "open" &&
        event.payload.generation === commitment.generation
      );
    case "done":
      return (
        commitment.id === request.commitmentId &&
        commitment.status === "done" &&
        commitment.result === request.result
      );
    case "abandon":
      return (
        commitment.id === request.commitmentId &&
        commitment.status === "abandoned" &&
        commitment.reason === request.reason
      );
    case "reopen":
      return (
        commitment.id === request.expectedCommitmentId &&
        commitment.status === "abandoned" &&
        event.payload.generation === commitment.generation + 1
      );
  }
}
