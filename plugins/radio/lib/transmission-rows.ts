import type { Database } from "./contracts.ts";
import type { Transmission } from "./transmission-contracts.ts";
import { RadioError } from "./errors.ts";

type Row = Omit<
  Transmission,
  "stationId" | "refs" | "tags" | "tokens" | "recipientIds"
> & { refsJson: string; tagsJson: string; tokensJson: string };
export function readTransmission(
  db: Database,
  stationId: string,
  id: string,
): Transmission {
  const row = db
    .prepare<[string], Row>(
      `SELECT seq AS cursor, id, author_id AS authorId,
    session_id AS sessionId, channel_id AS channelId, body, created_at AS createdAt,
    reply_to_id AS replyToId, refs_json AS refsJson, tags_json AS tagsJson, tokens_json AS tokensJson
    FROM transmissions WHERE id = ?`,
    )
    .get(id);
  if (!row)
    throw new RadioError("not_found", "Unknown or inaccessible transmission.");
  const { refsJson, tagsJson, tokensJson, ...value } = row;
  const recipients = db
    .prepare<[string], { id: string }>(
      "SELECT target_id AS id FROM transmission_recipients WHERE tx_id = ? ORDER BY target_id",
    )
    .all(id);
  return {
    ...value,
    stationId,
    refs: JSON.parse(refsJson),
    tags: JSON.parse(tagsJson),
    tokens: JSON.parse(tokensJson),
    recipientIds: recipients.map(({ id }) => id),
  };
}
