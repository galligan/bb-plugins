import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { SoulStore } from "../soul/store.ts";
import { recordSchema } from "../memory/contracts.ts";
import { eligibleSql } from "../memory/provenance.ts";
import {
  checkpointId,
  createSchema,
  headerSchema,
  snapshotSchema,
  type CreateCheckpoint,
} from "./contracts.ts";

const columns = "id,bot_id AS botId,name,author,reason,created_at AS createdAt";
const limitations = {
  portableFormat: "bbots-checkpoint@1",
  import: "not-supported",
  restore: "explicit-selected-revisions-only",
  operationalRecovery: "not-a-database-backup",
  liveContextRefresh: "not-performed",
  suppression: "current-exclusions-applied-per-page",
} as const;

export function openCheckpoints(
  storage: PluginStorage,
  store: SetupStore,
  soul: SoulStore,
) {
  const db = storage.database();
  function header(botId: string, id: string) {
    store.get(botId);
    id = checkpointId.parse(id);
    const row = db
      .prepare(`SELECT ${columns} FROM checkpoints WHERE bot_id=? AND id=?`)
      .get(botId, id);
    if (!row) throw new Error("Checkpoint was not found for this bot.");
    return headerSchema.parse(row);
  }
  function show(botId: string, id: string) {
    const checkpoint = header(botId, id);
    const row = db
      .prepare("SELECT snapshot_json AS snapshot FROM checkpoints WHERE id=?")
      .get(id) as { snapshot: string };
    const count = db
      .prepare(
        "SELECT COUNT(*) AS count FROM checkpoint_entries WHERE checkpoint_id=?",
      )
      .get(id) as { count: number };
    return {
      checkpoint,
      ...snapshotSchema.parse(JSON.parse(row.snapshot)),
      selectedDocuments: count.count,
      limitations,
    };
  }
  function create(input: CreateCheckpoint) {
    const value = createSchema.parse(input),
      id = `chk_${value.requestId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    return db
      .transaction(() => {
        store.get(value.botId);
        const previous = db
          .prepare("SELECT creation_hash AS hash FROM checkpoints WHERE id=?")
          .get(id) as { hash: string } | undefined;
        if (previous) {
          if (previous.hash !== hash)
            throw new Error(
              "Checkpoint request ID already records different options.",
            );
          return { ...show(value.botId, id), replay: true };
        }
        const profile = store.profiles.get(value.botId);
        const defaults = soul.defaults(value.botId);
        const executionDoc = store.documents.get(value.botId, "EXECUTION.json");
        const snapshot = snapshotSchema.parse({
          profile: store.profiles.revision(value.botId, profile.revision),
          execution: {
            documentId: executionDoc?.id ?? null,
            revision: defaults.revision,
            defaults: defaults.defaults,
            attribution: executionDoc
              ? {
                  author: executionDoc.author,
                  reason: executionDoc.reason,
                  createdAt: executionDoc.createdAt,
                }
              : null,
          },
        });
        db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?,?,?,?,?)").run(
          id,
          value.botId,
          value.name,
          hash,
          JSON.stringify(snapshot),
          value.author,
          value.reason,
          new Date().toISOString(),
        );
        db.prepare(
          `INSERT INTO checkpoint_entries
        SELECT ?,d.id,d.revision FROM documents d
        JOIN document_revisions r ON r.document_id=d.id AND r.revision=d.revision
        WHERE d.bot_id=? AND (d.name='SOUL.md' OR
          (d.name GLOB 'MEMORY:*' AND json_extract(CASE WHEN d.name GLOB 'MEMORY:*' THEN r.markdown ELSE 'null' END,'$.kind')='knowledge' AND ${eligibleSql}))
      `,
        ).run(id, value.botId);
        return { ...show(value.botId, id), replay: false };
      })
      .immediate();
  }
  function list(botId: string, after?: string) {
    store.get(botId);
    if (after) header(botId, after);
    const rows = db
      .prepare(
        `SELECT ${columns} FROM checkpoints WHERE bot_id=? AND id>? ORDER BY id LIMIT 11`,
      )
      .all(botId, after ?? "");
    const items = rows.slice(0, 10).map((row) => headerSchema.parse(row));
    return { items, nextCursor: rows.length > 10 ? items.at(-1)!.id : null };
  }
  function page(botId: string, id: string, after?: string) {
    return db.transaction(() => {
      const metadata = show(botId, id);
      if (
        after &&
        !db
          .prepare(
            "SELECT 1 FROM checkpoint_entries WHERE checkpoint_id=? AND document_id=?",
          )
          .get(id, z.string().max(128).parse(after))
      )
        throw new Error("Export cursor was not found in this checkpoint.");
      const rows = db
        .prepare(
          `SELECT d.id,d.name,c.revision FROM checkpoint_entries c
        JOIN documents d ON d.id=c.document_id WHERE c.checkpoint_id=? AND d.bot_id=? AND d.id>?
          AND (d.name='SOUL.md' OR ${eligibleSql}) ORDER BY d.id LIMIT 2
      `,
        )
        .all(id, botId, after ?? "") as {
        id: string;
        name: string;
        revision: number;
      }[];
      const selected = rows[0];
      let document = null;
      if (selected) {
        const doc = store.documents.revision(
          botId,
          selected.name,
          selected.revision,
        );
        if (doc.id !== selected.id)
          throw new Error("Selected document identity changed.");
        if (doc.name === "SOUL.md")
          document = { ...doc, kind: "soul" as const };
        else {
          const record = recordSchema.parse(JSON.parse(doc.markdown));
          if (
            record.kind !== "knowledge" ||
            selected.name !== `MEMORY:${record.requestId}.json`
          )
            throw new Error("Checkpoint includes an unsupported record.");
          const { markdown: _serialized, ...attribution } = doc;
          document = { ...attribution, kind: "knowledge" as const, record };
        }
      }
      return {
        format: "bbots-checkpoint" as const,
        schemaVersion: 1 as const,
        ...metadata,
        document,
        nextCursor: rows.length > 1 ? selected!.id : null,
      };
    })();
  }
  function selectedDocument(botId: string, id: string, name: string) {
    header(botId, id);
    const row = db
      .prepare(
        `SELECT c.revision FROM checkpoint_entries c JOIN documents d ON d.id=c.document_id
      WHERE c.checkpoint_id=? AND d.bot_id=? AND d.name=? AND (d.name='SOUL.md' OR ${eligibleSql})`,
      )
      .get(id, botId, name) as { revision: number } | undefined;
    if (!row)
      throw new Error("Document is absent or excluded from this checkpoint.");
    return store.documents.revision(botId, name, row.revision);
  }
  return { create, show, list, page, selectedDocument };
}
export type Checkpoints = ReturnType<typeof openCheckpoints>;

export function markdownExport(value: ReturnType<Checkpoints["page"]>) {
  const json = JSON.stringify(value, null, 2);
  const fence = "`".repeat(
    Math.max(
      3,
      ...Array.from(json.matchAll(/`+/g), (match) => match[0].length + 1),
    ),
  );
  return `# Bots checkpoint export\n\nPortable page; follow nextCursor until null. Current forgetting exclusions apply. This is not a database backup or an import/restore instruction.\n\n${fence}json\n${json}\n${fence}\n`;
}
