import { z } from "zod";
import type { Database } from "./contracts.ts";
import { idSchema } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import type { AddressScope } from "./address-resolution.ts";
import {
  requireAuthor,
  requireChannel,
  requireOwnTarget,
} from "./transmission-access.ts";
import { parseProtocol } from "./protocol-contracts.ts";
import { RadioError } from "./errors.ts";

const mutationSchema = z
  .object({
    channelId: idSchema,
    targetId: idSchema.optional(),
    kind: z.enum(["listen", "mute", "unlisten"]),
  })
  .strict();
const listingSchema = z
  .object({
    targetId: idSchema.optional(),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export interface Subscription {
  cursor: number;
  targetId: string;
  channelId: string;
  muted: boolean;
}
type Row = Omit<Subscription, "muted"> & { muted: number };
type Domain = Pick<RadioStore, "identities" | "projects">;

export class Subscriptions {
  private db: Database;
  private store: Domain;
  constructor(db: Database, store: Domain) {
    this.db = db;
    this.store = store;
  }

  set(context: TransmissionContext, input: unknown) {
    const request = parseProtocol(mutationSchema, input);
    requireAuthor(this.store.identities, context);
    const targetId = request.targetId ?? context.sessionId ?? context.authorId;
    requireOwnTarget(this.store.identities, context, targetId);
    return this.db
      .transaction(() => {
        if (request.kind === "unlisten") {
          // An owner can always remove its subscription, even after access loss.
          this.db
            .prepare(
              "DELETE FROM subscriptions WHERE target_id = ? AND channel_id = ?",
            )
            .run(targetId, request.channelId);
          return {
            state: "unlistening" as const,
            targetId,
            channelId: request.channelId,
          };
        }
        if (request.kind === "listen") {
          requireChannel(this.store.projects, request.channelId, context.scope);
          this.db
            .prepare(
              "INSERT INTO subscriptions(target_id, channel_id, muted) VALUES (?, ?, 0) ON CONFLICT(target_id, channel_id) DO UPDATE SET muted = 0",
            )
            .run(targetId, request.channelId);
        } else {
          const update = this.db
            .prepare(
              "UPDATE subscriptions SET muted = 1 WHERE target_id = ? AND channel_id = ?",
            )
            .run(targetId, request.channelId);
          if (!update.changes)
            throw new RadioError(
              "not_found",
              "Listen before muting this channel.",
            );
        }
        const row = this.db
          .prepare<[string, string], Row>(
            "SELECT seq AS cursor, target_id AS targetId, channel_id AS channelId, muted FROM subscriptions WHERE target_id = ? AND channel_id = ?",
          )
          .get(targetId, request.channelId)!;
        return {
          state:
            request.kind === "listen"
              ? ("listening" as const)
              : ("muted" as const),
          subscription: this.decode(row),
        };
      })
      .immediate();
  }

  list(context: TransmissionContext, input: unknown) {
    const {
      targetId: requested,
      after,
      limit,
    } = parseProtocol(listingSchema, input);
    requireAuthor(this.store.identities, context);
    const targetId = requested ?? context.sessionId ?? context.authorId;
    requireOwnTarget(this.store.identities, context, targetId);
    if (context.scope.projectIds.length > 100)
      throw new RadioError(
        "invalid_input",
        "Use at most 100 accessible projects.",
      );
    const projects = [...new Set(context.scope.projectIds)];
    if (!projects.length)
      return { items: [], nextCursor: after, hasMore: false };
    const rows = this.db
      .prepare<unknown[], Row>(
        `SELECT s.seq AS cursor, s.target_id AS targetId, s.channel_id AS channelId, s.muted
      FROM subscriptions s JOIN channels c ON c.id = s.channel_id
      WHERE s.target_id = ? AND c.project_id IN (${projects.map(() => "?").join(",")}) AND s.seq > ? ORDER BY s.seq LIMIT ?`,
      )
      .all(targetId, ...projects, after, limit + 1);
    const items = rows.slice(0, limit).map((row) => this.decode(row));
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  /** Call inside tx creation's transaction to freeze exact-channel listeners. */
  eligible(scope: AddressScope, channelId: string): string[] {
    requireChannel(this.store.projects, channelId, scope);
    const rows = this.db
      .prepare<[string], { id: string }>(
        "SELECT target_id AS id FROM subscriptions WHERE channel_id = ? AND muted = 0 ORDER BY target_id LIMIT 101",
      )
      .all(channelId);
    if (rows.length > 100)
      throw new RadioError(
        "invalid_input",
        "Channel audience exceeds 100 recipients; choose a narrower explicit audience.",
      );
    return rows.map(({ id }) => id);
  }
  private decode(row: Row): Subscription {
    return { ...row, muted: row.muted === 1 };
  }
}
