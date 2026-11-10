import { randomUUID } from "node:crypto";
import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { AddressScope } from "./address-resolution.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { requireAuthor } from "./transmission-access.ts";
import { RadioError } from "./errors.ts";
import {
  responseSchema,
  eventPageSchema,
  parseProtocol,
  type ProtocolEvent,
} from "./protocol-contracts.ts";

type Domain = Pick<RadioStore, "stationId" | "identities" | "transmissions">;
type EventRow = Omit<ProtocolEvent, "payload" | "stationId"> & {
  payloadJson: string;
};
const COLUMNS =
  "id, seq AS cursor, tx_id AS txId, target_id AS targetId, actor_id AS actorId, session_id AS sessionId, kind, payload_json AS payloadJson, created_at AS createdAt";

export class ResponseEvents {
  private db: Database;
  private store: Domain;
  constructor(db: Database, store: Domain) {
    this.db = db;
    this.store = store;
  }

  /** Call only after an authenticated recipient explicitly confirms content receipt. */
  record(context: TransmissionContext, input: unknown) {
    const request = parseProtocol(responseSchema, input);
    const callerKey = requireAuthor(this.store.identities, context);
    const target = this.store.identities.get(request.targetId);
    if (target.id !== context.authorId && target.id !== context.sessionId)
      throw new RadioError(
        "forbidden",
        "Respond only for the invoking actor or exact acting session.",
      );
    if (target.actorId && target.actorId !== context.authorId)
      throw new RadioError(
        "forbidden",
        "Response target belongs to another actor.",
      );
    if (
      request.kind === "received" &&
      !context.sessionId &&
      target.kind !== "human"
    )
      throw new RadioError(
        "invalid_input",
        "Actor receipts require a concrete owned acting session.",
      );
    const requestJson = JSON.stringify({
      sessionId: context.sessionId ?? null,
      ...request,
    });
    return this.db
      .transaction(() => {
        this.store.transmissions.get(request.txId, context.scope);
        const prior = this.db
          .prepare<[string, string], { request: string; eventId: string }>(
            "SELECT request_json AS request, event_id AS eventId FROM protocol_requests WHERE caller_key = ? AND idempotency_key = ?",
          )
          .get(callerKey, request.idempotencyKey);
        if (prior) {
          if (prior.request !== requestJson)
            throw new RadioError(
              "conflict",
              "Protocol key is bound to a different operation.",
            );
          return { replayed: true, event: this.event(prior.eventId) };
        }
        const payload: ProtocolEvent["payload"] = {};
        let existing: { id: string } | undefined;
        if (request.kind === "received") {
          payload.endpointId = context.sessionId ?? context.authorId;
          payload.evidence = "recipient-confirmation";
          existing = this.db
            .prepare<[string, string, string], { id: string }>(
              "SELECT event_id AS id FROM receipt_confirmations WHERE tx_id = ? AND target_id = ? AND endpoint_id = ?",
            )
            .get(request.txId, target.id, payload.endpointId);
        }
        if (request.kind === "standby" && request.reason)
          payload.reason = request.reason;
        const id = existing?.id ?? `event_${randomUUID()}`;
        if (!existing) {
          this.db
            .prepare(
              "INSERT INTO response_events(id, tx_id, target_id, actor_id, session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              id,
              request.txId,
              target.id,
              context.authorId,
              context.sessionId ?? null,
              request.kind,
              JSON.stringify(payload),
              new Date().toISOString(),
            );
          if (request.kind === "received")
            this.db
              .prepare(
                "INSERT INTO receipt_confirmations(tx_id, target_id, endpoint_id, event_id) VALUES (?, ?, ?, ?)",
              )
              .run(request.txId, target.id, payload.endpointId!, id);
        }
        this.db
          .prepare(
            "INSERT INTO protocol_requests(caller_key, idempotency_key, request_json, event_id) VALUES (?, ?, ?, ?)",
          )
          .run(callerKey, request.idempotencyKey, requestJson, id);
        return { replayed: !!existing, event: this.event(id) };
      })
      .immediate();
  }

  list(scope: AddressScope, input: unknown) {
    const { txId, after, limit } = parseProtocol(eventPageSchema, input);
    this.store.transmissions.get(txId, scope);
    const rows = this.db
      .prepare<[string, number, number], EventRow>(
        `SELECT ${COLUMNS} FROM response_events WHERE tx_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
      )
      .all(txId, after, limit + 1);
    const items = rows.slice(0, limit).map((row) => this.decode(row));
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  summary(scope: AddressScope, txId: string) {
    const tx = this.store.transmissions.get(txId, scope);
    // Facts cover exactly their canonical target. An actor response never covers
    // its separately addressed sessions or changes the frozen denominator.
    return tx.recipientIds.map((targetId) => {
      const row = this.db
        .prepare<
          [string, string],
          {
            ackAt: string | null;
            standbyAt: string | null;
            squelchAt: string | null;
          }
        >(
          `SELECT max(CASE WHEN kind = 'ack' THEN created_at END) AS ackAt,
         max(CASE WHEN kind = 'standby' THEN created_at END) AS standbyAt,
         max(CASE WHEN kind = 'squelch' THEN created_at END) AS squelchAt
         FROM response_events WHERE tx_id = ? AND target_id = ?`,
        )
        .get(txId, targetId)!;
      const received = this.db
        .prepare<[string, string], { n: number }>(
          "SELECT count(*) AS n FROM receipt_confirmations WHERE tx_id = ? AND target_id = ?",
        )
        .get(txId, targetId)!.n;
      return { targetId, ...row, receivedEndpoints: received };
    });
  }

  private event(id: string): ProtocolEvent {
    const row = this.db
      .prepare<[string], EventRow>(
        `SELECT ${COLUMNS} FROM response_events WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new RadioError("not_found", "Unknown response event.");
    return this.decode(row);
  }
  private decode(row: EventRow): ProtocolEvent {
    const { payloadJson, ...event } = row;
    return {
      ...event,
      stationId: this.store.stationId,
      payload: JSON.parse(payloadJson),
    };
  }
}
