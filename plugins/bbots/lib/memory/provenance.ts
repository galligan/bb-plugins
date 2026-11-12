import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { documentName, recordSchema, type RecordBody } from "./contracts.ts";
import {
  originKey,
  originFromKey,
  originMatchesSql,
  type Origin,
} from "./origins.ts";

export const memoryMigrations = [
  `CREATE TABLE memory_sources (
    bot_id TEXT NOT NULL REFERENCES bots(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    source_id TEXT NOT NULL,
    PRIMARY KEY (bot_id, document_id, source_id)
  )`,
  `CREATE INDEX memory_source_lookup ON memory_sources(bot_id, source_id)`,
  `CREATE TABLE memory_exclusions (
    bot_id TEXT NOT NULL REFERENCES bots(id),
    kind TEXT NOT NULL CHECK (kind IN ('record','source')),
    key TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, kind, key)
  )`,
];

// Exclusions are operational state, never part of a checkpoint's selected revisions.
export const eligibleSql = `NOT EXISTS (
  SELECT 1 FROM memory_exclusions e WHERE e.bot_id=d.bot_id AND
  ((e.kind='record' AND e.key=d.name) OR (e.kind='source' AND EXISTS (
    SELECT 1 FROM memory_sources s WHERE s.bot_id=d.bot_id
      AND s.document_id=d.id AND ${originMatchesSql("s.source_id", "e.key")}
  )))
)`;

export function provenance(storage: PluginStorage, store: SetupStore) {
  const db = storage.database();
  function excluded(botId: string, name: string) {
    return !db
      .prepare(
        `SELECT 1 FROM documents d WHERE d.bot_id=? AND d.name=? AND ${eligibleSql}`,
      )
      .get(botId, name);
  }
  return {
    excluded,
    resolve(
      botId: string,
      input: Pick<RecordBody, "sources" | "parents" | "basis">,
      self?: string,
    ) {
      const sources = new Set(input.sources.map(originKey));
      for (const parent of input.parents) {
        if (parent.id === self)
          throw new Error("A record cannot derive from itself.");
        const name = documentName(parent.id);
        const doc = store.documents.get(botId, name);
        if (!doc || excluded(botId, name))
          throw new Error(
            "A provenance parent is missing or excluded for this bot.",
          );
        if (doc.revision !== parent.revision)
          throw new Error(
            "A provenance parent changed. Read it before capturing a result.",
          );
        if (
          recordSchema.parse(JSON.parse(doc.markdown)).basis === "inference" &&
          input.basis === "fact"
        )
          throw new Error("Derived inference cannot silently become fact.");
        const known = db
          .prepare(
            "SELECT source_id AS source FROM memory_sources WHERE bot_id=? AND document_id=? LIMIT 129",
          )
          .all(botId, doc.id) as { source: string }[];
        if (known.length > 128)
          throw new Error(
            "Parent provenance exceeds the bounded capture size.",
          );
        for (const row of known) sources.add(row.source);
      }
      if (sources.size === 0 || sources.size > 128)
        throw new Error(
          "Supply original sources or current parents; resolved provenance is limited to 128 sources.",
        );
      for (const source of sources)
        if (
          db
            .prepare(
              `SELECT 1 FROM memory_exclusions e CROSS JOIN (SELECT ? AS source_id) s
                WHERE e.bot_id=? AND e.kind='source' AND ${originMatchesSql("s.source_id", "e.key")} LIMIT 1`,
            )
            .get(source, botId)
        )
          throw new Error(
            "A known source is excluded. This result cannot be stored.",
          );
      return [...sources].sort().map(originFromKey);
    },
    retain(botId: string, documentId: string, sources: readonly Origin[]) {
      const insert = db.prepare(
        "INSERT OR IGNORE INTO memory_sources(bot_id,document_id,source_id) VALUES (?,?,?)",
      );
      for (const source of sources)
        insert.run(botId, documentId, originKey(source));
    },
    forget(botId: string, name: string, documentId: string, author: string) {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT OR IGNORE INTO memory_exclusions(bot_id,kind,key,author,created_at) VALUES (?,'record',?,?,?)",
      ).run(botId, name, author, now);
      db.prepare(
        `INSERT OR IGNORE INTO memory_exclusions(bot_id,kind,key,author,created_at)
        SELECT bot_id,'source',source_id,?,? FROM memory_sources WHERE bot_id=? AND document_id=?`,
      ).run(author, now, botId, documentId);
    },
  };
}
