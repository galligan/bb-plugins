import type { Database } from "./contracts.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import type {
  AttentionRequest,
  DiscoveryItem,
  RequiredResponse,
} from "./attention-contracts.ts";

export function discoveryPage(
  db: Database,
  context: TransmissionContext,
  projects: string[],
  request: AttentionRequest,
) {
  const actorId = context.authorId;
  const sessionId = context.sessionId ?? actorId;
  const rows = db
    .prepare<unknown[], DiscoveryItem>(
      `SELECT t.id, t.seq AS cursor, t.channel_id AS channelId,
    t.author_id AS authorId, t.body, t.created_at AS createdAt FROM transmissions t
    JOIN channels c ON c.id = t.channel_id WHERE c.project_id IN (${projects.map(() => "?").join(",")})
    AND t.seq > ? AND t.created_at >= ? AND (
      EXISTS (SELECT 1 FROM transmission_recipients r JOIN participants p ON p.id = r.target_id
        WHERE r.tx_id = t.id AND p.id IN (?, ?)
        AND NOT EXISTS (SELECT 1 FROM response_events e WHERE e.tx_id = t.id AND e.target_id = p.id AND e.kind = 'squelch'))
      OR (t.author_id != ? AND EXISTS (SELECT 1 FROM subscriptions s JOIN participants p ON p.id = s.target_id
        WHERE s.channel_id = t.channel_id AND s.muted = 0 AND p.id IN (?, ?)
        AND NOT EXISTS (SELECT 1 FROM response_events e WHERE e.tx_id = t.id AND e.target_id = p.id AND e.kind = 'squelch')))
      OR (t.author_id != ? AND EXISTS (SELECT 1 FROM transmissions parent WHERE parent.id = t.reply_to_id AND parent.author_id = ?
        AND (parent.session_id IS NULL OR parent.session_id = ?)
        AND NOT EXISTS (SELECT 1 FROM response_events e WHERE e.tx_id = t.id AND e.target_id = coalesce(parent.session_id, parent.author_id) AND e.kind = 'squelch'))))
    ORDER BY t.seq LIMIT ?`,
    )
    .all(
      ...projects,
      request.after,
      request.since ? new Date(request.since).toISOString() : "",
      actorId,
      sessionId,
      actorId,
      actorId,
      sessionId,
      actorId,
      actorId,
      context.sessionId ?? null,
      request.limit + 1,
    );
  const items = rows.slice(0, request.limit);
  return {
    items,
    nextCursor: items.at(-1)?.cursor ?? request.after,
    hasMore: rows.length > request.limit,
  };
}

export function requiredPage(
  db: Database,
  actorId: string,
  projects: string[],
  request: AttentionRequest,
) {
  const rows = db
    .prepare<
      unknown[],
      Omit<RequiredResponse, "needAck" | "needReply"> & {
        needAck: number;
        needReply: number;
      }
    >(
      `WITH needs AS (SELECT t.id AS txId, t.seq AS cursor, r.target_id AS targetId,
      (t.require_ack = 1 AND NOT EXISTS (SELECT 1 FROM response_events e
        WHERE e.tx_id = t.id AND e.target_id = r.target_id AND e.kind = 'ack')) AS needAck,
      (t.expect_reply = 1 AND NOT EXISTS (SELECT 1 FROM transmissions answer
        WHERE answer.reply_to_id = t.id AND answer.reply_for_id = r.target_id)) AS needReply
      FROM transmissions t JOIN channels c ON c.id = t.channel_id
      JOIN transmission_recipients r ON r.tx_id = t.id JOIN participants p ON p.id = r.target_id
      WHERE c.project_id IN (${projects.map(() => "?").join(",")}) AND (p.id = ? OR p.actor_id = ?)
      AND (t.seq > ? OR (t.seq = ? AND r.target_id > ?)))
     SELECT * FROM needs WHERE needAck OR needReply ORDER BY cursor, targetId LIMIT ?`,
    )
    .all(
      ...projects,
      actorId,
      actorId,
      request.requiredAfter.cursor,
      request.requiredAfter.cursor,
      request.requiredAfter.targetId,
      request.limit + 1,
    );
  const items = rows.slice(0, request.limit).map((row) => ({
    ...row,
    needAck: row.needAck === 1,
    needReply: row.needReply === 1,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: last
      ? { cursor: last.cursor, targetId: last.targetId }
      : request.requiredAfter,
    hasMore: rows.length > request.limit,
  };
}
