import { randomUUID } from "node:crypto";
import type { Database } from "./contracts.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import type {
  Commitment,
  CommitmentEvent,
  CommitmentAction,
} from "./commitment-contracts.ts";
import { RadioError } from "./errors.ts";

export const COMMITMENT_COLUMNS =
  "id, seq AS cursor, tx_id AS txId, target_id AS targetId, owner_actor_id AS ownerActorId, opening_session_id AS openingSessionId, generation, status, opened_at AS openedAt, closed_at AS closedAt, result, reason";
export class CommitmentRows {
  private db: Database;
  private stationId: string;
  constructor(db: Database, stationId: string) {
    this.db = db;
    this.stationId = stationId;
  }
  get(id: string): Commitment {
    const row = this.db
      .prepare<[string], Omit<Commitment, "stationId">>(
        `SELECT ${COMMITMENT_COLUMNS} FROM commitments WHERE id = ?`,
      )
      .get(id);
    if (!row)
      throw new RadioError("not_found", "Unknown or inaccessible commitment.");
    return { ...row, stationId: this.stationId };
  }
  append(
    context: TransmissionContext,
    commitment: Commitment,
    kind: CommitmentAction["kind"],
    generation = commitment.generation,
  ): CommitmentEvent {
    const id = `event_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO commitment_events(id, tx_id, commitment_id, actor_id, session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        commitment.txId,
        commitment.id,
        context.authorId,
        context.sessionId ?? null,
        kind,
        JSON.stringify({ generation }),
        new Date().toISOString(),
      );
    return this.event(id);
  }
  event(id: string): CommitmentEvent {
    const row = this.db
      .prepare<
        [string],
        Omit<CommitmentEvent, "stationId" | "payload"> & { payloadJson: string }
      >(
        "SELECT id, seq AS cursor, tx_id AS txId, commitment_id AS commitmentId, actor_id AS actorId, session_id AS sessionId, kind, payload_json AS payloadJson, created_at AS createdAt FROM commitment_events WHERE id = ?",
      )
      .get(id);
    if (!row) throw new RadioError("not_found", "Unknown commitment event.");
    const { payloadJson, ...event } = row;
    return {
      ...event,
      stationId: this.stationId,
      payload: JSON.parse(payloadJson),
    };
  }
}
