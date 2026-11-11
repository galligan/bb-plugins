import { randomUUID } from "node:crypto";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import { idSchema } from "../storage/schema.ts";
import {
  agreementSchema,
  agreementWriteSchema,
  workerSchema,
  workSchema,
  type Work,
} from "./contracts.ts";

export function openWork(storage: PluginStorage, store: SetupStore) {
  const db = storage.database();
  function get(conversationId: string) {
    idSchema.parse(conversationId);
    const row = db
      .prepare(
        `SELECT conversation_id AS conversationId,
      request_id AS requestId, request_json AS request, phase, error
      FROM worker_setup WHERE conversation_id = ?`,
      )
      .get(conversationId) as { request: string } | undefined;
    if (!row) throw new Error("Owned worker setup was not found.");
    return workerSchema.parse({ ...row, request: JSON.parse(row.request) });
  }
  function agreement(conversationId: string) {
    const owner = store.conversations.get(conversationId);
    const doc = store.documents.get(owner.botId, `contract:${owner.id}`);
    if (!doc)
      throw new Error(
        "Conversation has no reporting contract; no main destination is assumed.",
      );
    return {
      conversationId,
      revision: doc.revision,
      agreement: agreementSchema.parse(JSON.parse(doc.markdown)),
      author: doc.author,
      reason: doc.reason,
      createdAt: doc.createdAt,
    };
  }
  function findRequest(requestId: string) {
    const row = db
      .prepare(
        "SELECT conversation_id AS id FROM worker_setup WHERE request_id = ?",
      )
      .get(requestId) as { id: string } | undefined;
    return row ? get(row.id) : null;
  }
  return {
    get,
    agreement,
    findRequest,
    list(botId: string) {
      store.profiles.get(botId);
      const rows = db
        .prepare(
          `SELECT c.id FROM conversations c JOIN worker_setup w ON w.conversation_id=c.id
        WHERE c.bot_id=? ORDER BY c.created_at,c.id LIMIT 101`,
        )
        .all(botId) as { id: string }[];
      return {
        workers: rows.slice(0, 100).map(({ id }) => {
          const conversation = store.conversations.get(id);
          const setup = get(id);
          return {
            conversation,
            requestId: setup.requestId,
            title: setup.request.title,
            phase: setup.phase,
            error: setup.error,
          };
        }),
        hasMore: rows.length > 100,
      };
    },
    plan(input: Work) {
      const value = workSchema.parse(input);
      return db
        .transaction(() => {
          const existing = findRequest(value.requestId);
          if (existing) {
            if (JSON.stringify(existing.request) !== JSON.stringify(value))
              throw new Error(
                "Worker request ID was already used with different options.",
              );
            return existing;
          }
          store.get(value.botId);
          const conversationId = `conv_${randomUUID()}`;
          db.prepare(
            "INSERT INTO conversations (id,bot_id,role,thread_id,created_at) VALUES (?,?,'worker',NULL,?)",
          ).run(conversationId, value.botId, new Date().toISOString());
          store.documents.write({
            botId: value.botId,
            name: `contract:${conversationId}`,
            expectedRevision: 0,
            markdown: JSON.stringify(value.agreement),
            author: value.author,
            reason: value.reason,
          });
          db.prepare(
            "INSERT INTO worker_setup (conversation_id,request_id,request_json,phase,error) VALUES (?,?,?,'planned',NULL)",
          ).run(conversationId, value.requestId, JSON.stringify(value));
          return get(conversationId);
        })
        .immediate();
    },
    start(conversationId: string) {
      if (
        db
          .prepare(
            "UPDATE worker_setup SET phase='spawning',error=NULL WHERE conversation_id=? AND phase='planned'",
          )
          .run(conversationId).changes !== 1
      )
        throw new Error(
          "Worker creation has already been attempted; inspect its recorded outcome instead of respawning.",
        );
      return get(conversationId);
    },
    bind(conversationId: string, threadId: string) {
      return db
        .transaction(() => {
          const worker = get(conversationId);
          if (worker.phase !== "spawning" && worker.phase !== "bound")
            throw new Error("Worker has no active creation intent.");
          const owner = store.conversations.bindInitialThread(
            conversationId,
            threadId,
          );
          db.prepare(
            "UPDATE worker_setup SET phase='bound',error=NULL WHERE conversation_id=?",
          ).run(conversationId);
          return owner;
        })
        .immediate();
    },
    fail(conversationId: string, message: string) {
      db.prepare("UPDATE worker_setup SET error=? WHERE conversation_id=?").run(
        message.slice(0, 1024),
        conversationId,
      );
    },
    updateAgreement(input: z.infer<typeof agreementWriteSchema>) {
      const value = agreementWriteSchema.parse(input);
      get(value.conversationId);
      const owner = store.conversations.get(value.conversationId);
      store.documents.write({
        botId: owner.botId,
        name: `contract:${owner.id}`,
        expectedRevision: value.expectedRevision,
        markdown: JSON.stringify(value.agreement),
        author: value.author,
        reason: value.reason,
      });
      return agreement(value.conversationId);
    },
    pendingTitles(botId: string) {
      return (
        db
          .prepare(
            `SELECT w.conversation_id AS id FROM worker_setup w
        JOIN conversations c ON c.id=w.conversation_id JOIN bots b ON b.id=c.bot_id
        WHERE c.bot_id=? AND c.thread_id IS NOT NULL AND w.title_revision<>b.revision
        ORDER BY c.id LIMIT 101`,
          )
          .all(botId) as { id: string }[]
      ).map((row) => row.id);
    },
    titlePending(conversationId: string) {
      return !!db
        .prepare(
          `SELECT c.id FROM worker_setup w JOIN conversations c ON c.id=w.conversation_id
        JOIN bots b ON b.id=c.bot_id WHERE c.id=? AND w.title_revision<>b.revision`,
        )
        .get(conversationId);
    },
    titleApplied(conversationId: string, revision: number) {
      db.prepare(
        `UPDATE worker_setup SET title_revision=? WHERE conversation_id=?
        AND EXISTS(SELECT 1 FROM conversations c JOIN bots b ON b.id=c.bot_id WHERE c.id=? AND b.revision=?)`,
      ).run(revision, conversationId, conversationId, revision);
    },
  };
}
export type WorkStore = ReturnType<typeof openWork>;
