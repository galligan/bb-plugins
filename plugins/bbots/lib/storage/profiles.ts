import { randomUUID } from "node:crypto";
import type { PluginStorage } from "@get-bb/plugin-sdk";

type Database = ReturnType<PluginStorage["database"]>;
import { z } from "zod";
import { StoreError } from "./errors.ts";
import {
  botSchema,
  changeSchema,
  idSchema,
  nameSchema,
  revisionSchema,
  type Change,
} from "./schema.ts";

const columns =
  "id, name, revision, created_at AS createdAt, updated_at AS updatedAt";
const createSchema = changeSchema.extend({ name: nameSchema });
const renameSchema = createSchema.extend({
  botId: idSchema,
  expectedRevision: revisionSchema,
});

export class Profiles {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get(botId: string) {
    idSchema.parse(botId);
    const row = this.db
      .prepare(`SELECT ${columns} FROM bots WHERE id = ?`)
      .get(botId);
    if (!row) throw new StoreError("not_found", "Bot was not found.");
    return botSchema.parse(row);
  }

  create(input: Change & { name: string }) {
    const value = createSchema.parse(input);
    const id = `bot_${randomUUID()}`;
    const conversationId = `conv_${randomUUID()}`;
    const now = new Date().toISOString();
    return this.db
      .transaction(() => {
        this.db
          .prepare("INSERT INTO bots VALUES (?, ?, 1, ?, ?)")
          .run(id, value.name, now, now);
        this.db
          .prepare("INSERT INTO bot_revisions VALUES (?, 1, ?, ?, ?, ?)")
          .run(id, value.name, value.author, value.reason, now);
        this.db
          .prepare("INSERT INTO conversations VALUES (?, ?, 'main', NULL, ?)")
          .run(conversationId, id, now);
        return { bot: this.get(id), mainConversationId: conversationId };
      })
      .immediate();
  }

  rename(
    input: Change & { botId: string; expectedRevision: number; name: string },
  ) {
    const value = renameSchema.parse(input);
    return this.db
      .transaction(() => {
        this.get(value.botId);
        const now = new Date().toISOString();
        const result = this.db
          .prepare(
            "UPDATE bots SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
          )
          .run(value.name, now, value.botId, value.expectedRevision);
        if (result.changes !== 1)
          throw new StoreError(
            "revision_conflict",
            "Bot changed; reread it before editing.",
          );
        this.db
          .prepare("INSERT INTO bot_revisions VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            value.botId,
            value.expectedRevision + 1,
            value.name,
            value.author,
            value.reason,
            now,
          );
        return this.get(value.botId);
      })
      .immediate();
  }

  revision(botId: string, revision: number) {
    idSchema.parse(botId);
    revisionSchema.parse(revision);
    this.get(botId);
    const row = this.db
      .prepare(
        "SELECT bot_id AS botId, revision, name, author, reason, created_at AS createdAt FROM bot_revisions WHERE bot_id = ? AND revision = ?",
      )
      .get(botId, revision);
    if (!row) throw new StoreError("not_found", "Bot revision was not found.");
    return z
      .strictObject({
        botId: idSchema,
        revision: revisionSchema,
        name: nameSchema,
        ...changeSchema.shape,
        createdAt: z.string(),
      })
      .parse(row);
  }
}
