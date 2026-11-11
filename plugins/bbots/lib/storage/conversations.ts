import type { PluginStorage } from "@get-bb/plugin-sdk";

type Database = ReturnType<PluginStorage["database"]>;
import { StoreError } from "./errors.ts";
import { conversationSchema, idSchema } from "./schema.ts";

const columns =
  "id, bot_id AS botId, role, thread_id AS threadId, created_at AS createdAt";

export class Conversations {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get(conversationId: string) {
    idSchema.parse(conversationId);
    const row = this.db
      .prepare(`SELECT ${columns} FROM conversations WHERE id = ?`)
      .get(conversationId);
    if (!row) throw new StoreError("not_found", "Conversation was not found.");
    return conversationSchema.parse(row);
  }

  ownerOfThread(threadId: string) {
    idSchema.parse(threadId);
    const row = this.db
      .prepare(`SELECT ${columns} FROM conversations WHERE thread_id = ?`)
      .get(threadId);
    return row ? conversationSchema.parse(row) : null;
  }

  bindInitialThread(conversationId: string, threadId: string) {
    idSchema.parse(conversationId);
    idSchema.parse(threadId);
    return this.db
      .transaction(() => {
        const current = this.get(conversationId);
        if (current.threadId === threadId) return current;
        if (current.threadId !== null)
          throw new StoreError(
            "already_bound",
            "Conversation already has a thread; replacement needs a verified continuity transition.",
          );
        if (this.ownerOfThread(threadId))
          throw new StoreError(
            "thread_owned",
            "Thread belongs to another logical conversation.",
          );
        this.db
          .prepare(
            "UPDATE conversations SET thread_id = ? WHERE id = ? AND thread_id IS NULL",
          )
          .run(threadId, conversationId);
        return this.get(conversationId);
      })
      .immediate();
  }
}
