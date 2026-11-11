import { randomUUID } from "node:crypto";
import type { PluginStorage } from "@get-bb/plugin-sdk";

type Database = ReturnType<PluginStorage["database"]>;
import { z } from "zod";
import { StoreError } from "./errors.ts";
import {
  changeSchema,
  documentSchema,
  idSchema,
  nameSchema,
  revisionSchema,
  type Change,
} from "./schema.ts";

const columns =
  "d.id, d.bot_id AS botId, d.name, r.revision, r.markdown, r.author, r.reason, r.created_at AS createdAt";
const writeSchema = changeSchema.extend({
  botId: idSchema,
  name: nameSchema,
  expectedRevision: z.number().int().nonnegative(),
  markdown: documentSchema.shape.markdown,
});

export class Documents {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get(botId: string, name: string) {
    idSchema.parse(botId);
    name = nameSchema.parse(name);
    const row = this.db
      .prepare(
        `SELECT ${columns} FROM documents d JOIN document_revisions r ON r.document_id = d.id AND r.revision = d.revision WHERE d.bot_id = ? AND d.name = ?`,
      )
      .get(botId, name);
    return row ? documentSchema.parse(row) : null;
  }

  write(
    input: Change & {
      botId: string;
      name: string;
      expectedRevision: number;
      markdown: string;
    },
  ) {
    const value = writeSchema.parse(input);
    return this.db
      .transaction(() => {
        if (
          !this.db.prepare("SELECT id FROM bots WHERE id = ?").get(value.botId)
        )
          throw new StoreError("not_found", "Bot was not found.");
        const current = this.get(value.botId, value.name);
        if ((current?.revision ?? 0) !== value.expectedRevision)
          throw new StoreError(
            "revision_conflict",
            "Document changed; reread it before editing.",
          );
        const id = current?.id ?? `doc_${randomUUID()}`;
        const revision = value.expectedRevision + 1;
        if (current) {
          this.db
            .prepare("UPDATE documents SET revision = ? WHERE id = ?")
            .run(revision, id);
        } else {
          this.db
            .prepare("INSERT INTO documents VALUES (?, ?, ?, ?)")
            .run(id, value.botId, value.name, revision);
        }
        this.db
          .prepare("INSERT INTO document_revisions VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            id,
            revision,
            value.markdown,
            value.author,
            value.reason,
            new Date().toISOString(),
          );
        return documentSchema.parse(this.get(value.botId, value.name));
      })
      .immediate();
  }

  revision(botId: string, name: string, revision: number) {
    idSchema.parse(botId);
    name = nameSchema.parse(name);
    revisionSchema.parse(revision);
    const row = this.db
      .prepare(
        `SELECT ${columns} FROM documents d JOIN document_revisions r ON r.document_id = d.id WHERE d.bot_id = ? AND d.name = ? AND r.revision = ?`,
      )
      .get(botId, name, revision);
    if (!row)
      throw new StoreError("not_found", "Document revision was not found.");
    return documentSchema.parse(row);
  }
}
