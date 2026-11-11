import { randomUUID } from "node:crypto";
import type { Database } from "./contracts.ts";
import { idSchema } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { AddressScope } from "./address-resolution.ts";
import { resolveAddress } from "./address-resolution.ts";
import { parseBody } from "./body-parser.ts";
import { RadioError } from "./errors.ts";
import {
  requireAuthor,
  requireChannel,
  requireOwnTarget,
} from "./transmission-access.ts";
import { readTransmission } from "./transmission-rows.ts";
import {
  parseSend,
  scanSchema,
  TX_RECIPIENTS_MAX,
  type Transmission,
  type TransmissionContext,
} from "./transmission-contracts.ts";

export class Transmissions {
  private db: Database;
  private store: Pick<
    RadioStore,
    | "stationId"
    | "identities"
    | "projects"
    | "handles"
    | "dispatches"
    | "subscriptions"
  >;
  constructor(
    db: Database,
    store: Pick<
      RadioStore,
      | "stationId"
      | "identities"
      | "projects"
      | "handles"
      | "dispatches"
      | "subscriptions"
    >,
  ) {
    this.db = db;
    this.store = store;
  }

  send(context: TransmissionContext, input: unknown) {
    const request = parseSend(input);
    const callerKey = requireAuthor(this.store.identities, context);
    // Bind exact source input before mutable handle resolution. A lost response
    // must replay the original targets even after an alias is reclaimed.
    // Keep the shipped default request encoding byte-for-byte replayable.
    const { requestMode, requireAck, expectReply, ...core } = request;
    const requestJson = JSON.stringify({
      sessionId: context.sessionId ?? null,
      ...core,
      ...(requestMode === "exclusive" ? { requestMode } : {}),
      ...(requireAck ? { requireAck } : {}),
      ...(expectReply ? { expectReply } : {}),
    });
    return this.db
      .transaction(() => {
        const channel = requireChannel(
          this.store.projects,
          request.channelId,
          context.scope,
        );
        const prior = this.db
          .prepare<[string, string], { id: string; request: string }>(
            "SELECT id, request_json AS request FROM transmissions WHERE caller_key = ? AND idempotency_key = ?",
          )
          .get(callerKey, request.idempotencyKey);
        if (prior) {
          if (prior.request !== requestJson)
            throw new RadioError(
              "conflict",
              "Idempotency key is already bound to a different transmission request.",
            );
          return {
            state: "sent" as const,
            replayed: true,
            transmission: this.get(prior.id, context.scope),
          };
        }
        let replyForId: string | null = null;
        if (request.replyToId) {
          const parent = this.get(request.replyToId, context.scope);
          if (parent.channelId !== channel.id)
            throw new RadioError(
              "invalid_input",
              "Replies must stay in the parent's channel; no audience is inherited.",
            );
          const eligible = parent.recipientIds.filter(
            (id) => id === context.authorId || id === context.sessionId,
          );
          if (request.replyForId) {
            requireOwnTarget(
              this.store.identities,
              context,
              request.replyForId,
            );
            if (!eligible.includes(request.replyForId))
              throw new RadioError(
                "invalid_input",
                "Reply coverage must select an original recipient owned by this caller.",
              );
            replyForId = request.replyForId;
          } else if (eligible.length > 1) {
            throw new RadioError(
              "ambiguous",
              "Choose the exact actor or session recipient this reply answers; the other obligation stays open.",
              eligible,
            );
          } else replyForId = eligible[0] ?? null;
        } else if (request.replyForId) {
          throw new RadioError(
            "invalid_input",
            "Reply recipient coverage requires a reply parent.",
          );
        }
        const recipients = new Set(request.recipientIds);
        const audiences = new Map<string, number>();
        for (const id of recipients) this.requireParticipant(id, context.scope);
        const tokens: Transmission["tokens"] = parseBody(request.body).map(
          (token) => {
            if (token.kind === "tag") return token;
            const resolved = resolveAddress(this.store, token, {
              ...context.scope,
              currentProjectId: channel.projectId,
            });
            if (
              token.kind === "channel-audience" &&
              !audiences.has(resolved.targetId)
            ) {
              const listeners = this.store.subscriptions.eligible(
                context.scope,
                resolved.targetId,
              );
              audiences.set(resolved.targetId, listeners.length);
              for (const targetId of listeners) recipients.add(targetId);
            }
            if (resolved.targetKind !== "channel")
              recipients.add(resolved.targetId);
            return {
              ...token,
              targetId: resolved.targetId,
              stationId: resolved.stationId,
            };
          },
        );
        if (recipients.size > TX_RECIPIENTS_MAX)
          throw new RadioError(
            "invalid_input",
            `Select at most ${TX_RECIPIENTS_MAX} recipients.`,
          );
        const refs = request.refs.map((ref) => {
          if (ref.kind === "transmission") this.get(ref.id, context.scope);
          if (ref.kind === "channel")
            requireChannel(this.store.projects, ref.id, context.scope);
          if (ref.kind === "participant")
            this.requireParticipant(ref.id, context.scope);
          if (ref.kind === "dispatch") {
            const dispatch = this.store.dispatches.get(context.scope, {
              id: ref.id,
              revision: ref.revision,
            });
            return { ...ref, revision: dispatch.revision };
          }
          return ref;
        });
        const id = `tx_${randomUUID()}`;
        this.db
          .prepare(
            `INSERT INTO transmissions
        (id, author_id, session_id, channel_id, body, created_at, reply_to_id, refs_json, tags_json,
         tokens_json, caller_key, idempotency_key, request_json, request_mode, require_ack, expect_reply, audiences_json, reply_for_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            context.authorId,
            context.sessionId ?? null,
            channel.id,
            request.body,
            new Date().toISOString(),
            request.replyToId ?? null,
            JSON.stringify(refs),
            JSON.stringify(
              [
                ...new Set(
                  tokens.flatMap((token) =>
                    token.kind === "tag" ? [token.name] : [],
                  ),
                ),
              ].sort(),
            ),
            JSON.stringify(tokens),
            callerKey,
            request.idempotencyKey,
            requestJson,
            requestMode,
            requireAck ? 1 : 0,
            expectReply ? 1 : 0,
            JSON.stringify(
              [...audiences].map(([channelId, eligibleCount]) => ({
                channelId,
                eligibleCount,
              })),
            ),
            replyForId,
          );
        if (requestMode === "exclusive")
          this.db
            .prepare(
              "INSERT INTO exclusive_claims(tx_id, generation, commitment_id) VALUES (?, 1, NULL)",
            )
            .run(id);
        const insertRecipient = this.db.prepare(
          "INSERT INTO transmission_recipients(tx_id, target_id) VALUES (?, ?)",
        );
        for (const targetId of recipients) insertRecipient.run(id, targetId);
        return {
          state: "sent" as const,
          replayed: false,
          transmission: this.get(id, context.scope),
        };
      })
      .immediate();
  }

  get(id: string, scope: AddressScope): Transmission {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success)
      throw new RadioError("invalid_input", "Invalid transmission ID.");
    const tx = readTransmission(this.db, this.store.stationId, parsed.data);
    requireChannel(this.store.projects, tx.channelId, scope);
    return tx;
  }

  scan(scope: AddressScope, input: unknown) {
    const parsed = scanSchema.safeParse(input);
    if (!parsed.success)
      throw new RadioError(
        "invalid_input",
        "Use a channel, nonnegative cursor and limit from 1 to 50.",
      );
    const { channelId, after, limit } = parsed.data;
    requireChannel(this.store.projects, channelId, scope);
    const rows = this.db
      .prepare<[string, number, number], { id: string }>(
        "SELECT id FROM transmissions WHERE channel_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(channelId, after, limit + 1);
    const items = rows.slice(0, limit).map(({ id }) => this.get(id, scope));
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  private requireParticipant(id: string, scope: AddressScope) {
    const participant = this.store.identities.get(id);
    if (participant.kind === "human") return;
    const visible = scope.projectIds.some((projectId) =>
      this.db
        .prepare(
          "SELECT 1 FROM handles WHERE project_id = ? AND target_id IN (?, ?)",
        )
        .get(projectId, participant.id, participant.actorId ?? participant.id),
    );
    if (!visible)
      throw new RadioError(
        "not_found",
        "Unknown or inaccessible participant reference.",
      );
  }
}
