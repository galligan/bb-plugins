import { randomUUID } from "node:crypto";
import type { Database } from "./contracts.ts";
import { idSchema } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type {
  TransmissionContext,
  Transmission,
} from "./transmission-contracts.ts";
import type { AddressScope } from "./address-resolution.ts";
import { requireAuthor } from "./transmission-access.ts";
import { parseProtocol, eventPageSchema } from "./protocol-contracts.ts";
import {
  commitmentActionSchema,
  commitmentListSchema,
  type Commitment,
  type CommitmentOutcome,
} from "./commitment-contracts.ts";
import { CommitmentRows } from "./commitment-rows.ts";
import { RadioError } from "./errors.ts";

type Domain = Pick<RadioStore, "stationId" | "identities" | "transmissions">;
type Claim = { generation: number; commitmentId: string | null };
export class Commitments {
  private db: Database;
  private store: Domain;
  private rows: CommitmentRows;
  constructor(db: Database, store: Domain) {
    this.db = db;
    this.store = store;
    this.rows = new CommitmentRows(db, store.stationId);
  }

  act(context: TransmissionContext, input: unknown) {
    const request = parseProtocol(commitmentActionSchema, input);
    const callerKey = requireAuthor(this.store.identities, context);
    const requestJson = JSON.stringify({
      sessionId: context.sessionId ?? null,
      ...request,
    });
    return this.db
      .transaction(() => {
        const previous =
          request.kind === "done" || request.kind === "abandon"
            ? this.rows.get(request.commitmentId)
            : null;
        const tx = this.store.transmissions.get(
          request.kind === "done" || request.kind === "abandon"
            ? previous!.txId
            : request.txId,
          context.scope,
        );
        if (request.kind === "reopen") {
          if (tx.authorId !== context.authorId)
            throw new RadioError(
              "forbidden",
              "Only the original request author may reopen an abandoned exclusive claim.",
            );
        } else
          this.requireTarget(
            context,
            request.kind === "wilco" ? request.targetId : previous!.targetId,
          );
        const replay = this.db
          .prepare<[string, string], { request: string; result: string }>(
            "SELECT request_json AS request, result_json AS result FROM commitment_requests WHERE caller_key = ? AND idempotency_key = ?",
          )
          .get(callerKey, request.idempotencyKey);
        if (replay) {
          if (replay.request !== requestJson)
            throw new RadioError(
              "conflict",
              "Commitment key is bound to a different operation.",
            );
          return {
            replayed: true,
            ...(JSON.parse(replay.result) as CommitmentOutcome),
          };
        }
        let outcome: CommitmentOutcome;
        let duplicate = false;
        if (request.kind === "wilco") {
          const result = this.accept(context, tx, request.targetId);
          outcome = result.outcome;
          duplicate = result.duplicate;
        } else if (request.kind === "reopen") {
          const claim = this.claim(tx.id);
          if (
            tx.requestMode !== "exclusive" ||
            claim.commitmentId !== request.expectedCommitmentId
          )
            throw new RadioError(
              "conflict",
              "Exclusive claim changed; inspect it before reopening.",
            );
          const abandoned = this.rows.get(request.expectedCommitmentId);
          if (abandoned.status !== "abandoned")
            throw new RadioError(
              "conflict",
              "Only an abandoned exclusive claim can be reopened.",
            );
          this.db
            .prepare(
              "UPDATE exclusive_claims SET generation = generation + 1, commitment_id = NULL WHERE tx_id = ?",
            )
            .run(tx.id);
          outcome = {
            commitment: abandoned,
            event: this.rows.append(
              context,
              abandoned,
              "reopen",
              claim.generation + 1,
            ),
          };
        } else {
          if (previous!.status !== "open")
            throw new RadioError("conflict", "Commitment is already closed.");
          this.db
            .prepare(
              "UPDATE commitments SET status = ?, closed_at = ?, result = ?, reason = ? WHERE id = ?",
            )
            .run(
              request.kind === "done" ? "done" : "abandoned",
              new Date().toISOString(),
              request.kind === "done" ? request.result : null,
              request.kind === "abandon" ? request.reason : null,
              previous!.id,
            );
          const commitment = this.rows.get(previous!.id);
          outcome = {
            commitment,
            event: this.rows.append(context, commitment, request.kind),
          };
        }
        // Snapshot the result: replaying wilco after closure must return its original
        // accepted operation, not a newly derived state or another generation.
        this.db
          .prepare(
            "INSERT INTO commitment_requests(caller_key, idempotency_key, request_json, event_id, result_json) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            callerKey,
            request.idempotencyKey,
            requestJson,
            outcome.event.id,
            JSON.stringify(outcome),
          );
        return { replayed: duplicate, ...outcome };
      })
      .immediate();
  }

  get(scope: AddressScope, id: string): Commitment {
    const commitment = this.rows.get(parseProtocol(idSchema, id));
    this.store.transmissions.get(commitment.txId, scope);
    return commitment;
  }

  events(scope: AddressScope, input: unknown) {
    const { txId, after, limit } = parseProtocol(eventPageSchema, input);
    this.store.transmissions.get(txId, scope);
    const rows = this.db
      .prepare<[string, number, number], { id: string }>(
        "SELECT id FROM commitment_events WHERE tx_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(txId, after, limit + 1);
    const items = rows.slice(0, limit).map(({ id }) => this.rows.event(id));
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  list(context: TransmissionContext, input: unknown) {
    requireAuthor(this.store.identities, context);
    const { after, limit, status } = parseProtocol(commitmentListSchema, input);
    const projects = [...new Set(context.scope.projectIds)];
    if (context.scope.projectIds.length > 100)
      throw new RadioError(
        "invalid_input",
        "Use at most 100 accessible projects.",
      );
    if (!projects.length)
      return { items: [], nextCursor: after, hasMore: false };
    const rows = this.db
      .prepare<unknown[], { id: string }>(
        `SELECT k.id FROM commitments k
      JOIN transmissions t ON t.id = k.tx_id JOIN channels c ON c.id = t.channel_id
      WHERE k.owner_actor_id = ? AND c.project_id IN (${projects.map(() => "?").join(",")})
      AND k.seq > ? AND (? = 'all' OR k.status = 'open') ORDER BY k.seq LIMIT ?`,
      )
      .all(context.authorId, ...projects, after, status, limit + 1);
    const items = rows.slice(0, limit).map(({ id }) => this.rows.get(id));
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  private requireTarget(context: TransmissionContext, targetId: string) {
    const target = this.store.identities.get(targetId);
    if (target.id !== context.authorId && target.id !== context.sessionId)
      throw new RadioError(
        "forbidden",
        "Act only for the invoking actor or exact acting session; obligations are not transferred.",
      );
    if (target.actorId && target.actorId !== context.authorId)
      throw new RadioError("forbidden", "Commitment belongs to another actor.");
  }
  private claim(txId: string): Claim {
    const row = this.db
      .prepare<[string], Claim>(
        "SELECT generation, commitment_id AS commitmentId FROM exclusive_claims WHERE tx_id = ?",
      )
      .get(txId);
    if (!row)
      throw new RadioError(
        "conflict",
        "Transmission has no exclusive request to claim.",
      );
    return row;
  }
  private accept(
    context: TransmissionContext,
    tx: Transmission,
    targetId: string,
  ) {
    let generation = 0;
    if (tx.requestMode === "exclusive") {
      if (tx.recipientIds.length && !tx.recipientIds.includes(targetId))
        throw new RadioError(
          "forbidden",
          "This exclusive request addresses a different target.",
        );
      const claim = this.claim(tx.id);
      generation = claim.generation;
      if (claim.commitmentId) {
        const prior = this.rows.get(claim.commitmentId);
        if (prior.targetId !== targetId || prior.status !== "open")
          throw new RadioError(
            "conflict",
            "Exclusive request is already claimed or closed; the author must reopen an abandoned claim.",
          );
      }
    }
    const prior = this.db
      .prepare<[string, string, number], { id: string }>(
        "SELECT id FROM commitments WHERE tx_id = ? AND target_id = ? AND generation = ?",
      )
      .get(tx.id, targetId, generation);
    if (prior) {
      const commitment = this.rows.get(prior.id);
      if (commitment.status !== "open")
        throw new RadioError(
          "conflict",
          "This target already closed its commitment; use a new transmission for new work.",
        );
      const event = this.db
        .prepare<[string], { id: string }>(
          "SELECT id FROM commitment_events WHERE commitment_id = ? AND kind = 'wilco'",
        )
        .get(prior.id)!;
      return {
        duplicate: true,
        outcome: { commitment, event: this.rows.event(event.id) },
      };
    }
    const id = `commitment_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO commitments(id, tx_id, target_id, owner_actor_id, opening_session_id, generation, status, opened_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
      )
      .run(
        id,
        tx.id,
        targetId,
        context.authorId,
        context.sessionId ?? null,
        generation,
        new Date().toISOString(),
      );
    if (tx.requestMode === "exclusive")
      this.db
        .prepare(
          "UPDATE exclusive_claims SET commitment_id = ? WHERE tx_id = ?",
        )
        .run(id, tx.id);
    const commitment = this.rows.get(id);
    return {
      duplicate: false,
      outcome: {
        commitment,
        event: this.rows.append(context, commitment, "wilco"),
      },
    };
  }
}
