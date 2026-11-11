import type { Database } from "./contracts.ts";
import type { Transmission } from "./transmission-contracts.ts";
import { RadioError } from "./errors.ts";

type Row = Omit<
  Transmission,
  | "stationId"
  | "refs"
  | "tags"
  | "tokens"
  | "recipientIds"
  | "requireAck"
  | "expectReply"
  | "audiences"
> & {
  refsJson: string;
  tagsJson: string;
  tokensJson: string;
  requireAck: number;
  expectReply: number;
  audiencesJson: string;
};
export function readTransmission(
  db: Database,
  stationId: string,
  id: string,
): Transmission {
  const row = db
    .prepare<[string], Row>(
      `SELECT seq AS cursor, id, author_id AS authorId,
    session_id AS sessionId, channel_id AS channelId, body, created_at AS createdAt,
    reply_to_id AS replyToId, refs_json AS refsJson, tags_json AS tagsJson, tokens_json AS tokensJson,
    request_mode AS requestMode, require_ack AS requireAck, expect_reply AS expectReply, audiences_json AS audiencesJson
    FROM transmissions WHERE id = ?`,
    )
    .get(id);
  if (!row)
    throw new RadioError("not_found", "Unknown or inaccessible transmission.");
  const { refsJson, tagsJson, tokensJson, audiencesJson, ...value } = row;
  const recipients = db
    .prepare<[string], { id: string }>(
      "SELECT target_id AS id FROM transmission_recipients WHERE tx_id = ? ORDER BY target_id",
    )
    .all(id);
  return {
    ...value,
    requireAck: value.requireAck === 1,
    expectReply: value.expectReply === 1,
    stationId,
    audiences: JSON.parse(audiencesJson),
    refs: JSON.parse(refsJson),
    tags: JSON.parse(tagsJson),
    tokens: JSON.parse(tokensJson),
    recipientIds: recipients.map(({ id }) => id),
  };
}
