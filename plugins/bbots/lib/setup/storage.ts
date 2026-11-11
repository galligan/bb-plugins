import type { PluginStorage } from "@get-bb/plugin-sdk";
import { randomUUID } from "node:crypto";
import { openStore } from "../storage/store.ts";
import { StoreError } from "../storage/errors.ts";
import {
  createSchema,
  setupSchema,
  type CreateBotInput,
  type Setup,
} from "./contracts.ts";

const columns =
  "bot_id AS botId, conversation_id AS conversationId, request_id AS requestId, request_json AS requestJson, home_path AS homePath, project_id AS projectId, phase, error";
export const starterSoul =
  "You are a persistent collaborator. Be candid, practical and curious. Distinguish evidence from inference. Respect explicit Stop and do not resume canceled assignments because a conversation became idle. Ask when a material decision belongs to the user.";

export function openSetup(storage: PluginStorage) {
  const records = openStore(storage);
  const db = storage.database();
  function get(botId: string): Setup {
    const row = db
      .prepare(`SELECT ${columns} FROM bot_setup WHERE bot_id = ?`)
      .get(botId) as
      (Record<string, unknown> & { requestJson: string }) | undefined;
    if (!row) throw new StoreError("not_found", "Bot setup was not found.");
    const { requestJson, ...rest } = row;
    return setupSchema.parse({ ...rest, request: JSON.parse(requestJson) });
  }
  function plan(input: CreateBotInput) {
    const value = createSchema.parse(input);
    return db
      .transaction(() => {
        const existing = db
          .prepare(
            "SELECT bot_id AS id, request_json AS request FROM bot_setup WHERE request_id = ?",
          )
          .get(value.requestId) as { id: string; request: string } | undefined;
        if (existing) {
          if (existing.request !== JSON.stringify(value))
            throw new Error(
              "Request ID was already used with different creation options.",
            );
          return get(existing.id);
        }
        const created = records.profiles.create({
          name: value.name,
          author: "bbots:create",
          reason: "Explicit bot creation request",
        });
        records.documents.write({
          botId: created.bot.id,
          name: "SOUL.md",
          expectedRevision: 0,
          markdown: starterSoul,
          author: "bbots:create",
          reason: "Initial editable starter soul",
        });
        db.prepare(
          "INSERT INTO bot_setup (bot_id,conversation_id,request_id,request_json) VALUES (?,?,?,?)",
        ).run(
          created.bot.id,
          created.mainConversationId,
          value.requestId,
          JSON.stringify(value),
        );
        return get(created.bot.id);
      })
      .immediate();
  }
  function phase(botId: string, from: Setup["phase"], to: Setup["phase"]) {
    if (
      db
        .prepare(
          "UPDATE bot_setup SET phase=?,error=NULL WHERE bot_id=? AND phase=?",
        )
        .run(to, botId, from).changes !== 1
    )
      throw new Error(
        "Bot setup changed or is already running; reread it before retrying.",
      );
    return get(botId);
  }
  return {
    ...records,
    get,
    findRequest: (requestId: string) => {
      const row = db
        .prepare("SELECT bot_id AS botId FROM bot_setup WHERE request_id = ?")
        .get(requestId) as { botId: string } | undefined;
      return row ? get(row.botId) : null;
    },
    plan,
    phase,
    view: (botId: string) => {
      const setup = get(botId);
      return {
        bot: records.profiles.get(botId),
        main: records.conversations.get(setup.conversationId),
        setup,
      };
    },
    list: () => {
      const rows = db
        .prepare("SELECT id FROM bots ORDER BY created_at,id LIMIT 101")
        .all() as { id: string }[];
      return {
        bots: rows.slice(0, 100).map((r) => records.profiles.get(r.id)),
        hasMore: rows.length > 100,
      };
    },
    setHome: (botId: string, path: string) =>
      db
        .prepare(
          "UPDATE bot_setup SET home_path=?,phase='home-ready',error=NULL WHERE bot_id=? AND phase='planned'",
        )
        .run(path, botId),
    setProject: (botId: string, id: string) =>
      db
        .prepare(
          "UPDATE bot_setup SET project_id=?,phase='project-ready',error=NULL WHERE bot_id=? AND phase IN ('home-ready','project-creating')",
        )
        .run(id, botId),
    fail: (botId: string, error: string | null) =>
      db
        .prepare("UPDATE bot_setup SET error=? WHERE bot_id=?")
        .run(error?.slice(0, 1024) ?? null, botId),
    bind: (botId: string, threadId: string) =>
      db
        .transaction(() => {
          const setup = get(botId);
          if (!["spawning", "owned", "ready"].includes(setup.phase))
            throw new Error("Bot has no pending main creation intent.");
          records.conversations.bindInitialThread(
            setup.conversationId,
            threadId,
          );
          db.prepare(
            "UPDATE bot_setup SET phase='owned',error=NULL WHERE bot_id=? AND phase<>'ready'",
          ).run(botId);
        })
        .immediate(),
    titlePending: (botId: string) => {
      const row = db
        .prepare(
          "SELECT title_revision AS revision FROM bot_setup WHERE bot_id=?",
        )
        .get(botId) as { revision: number };
      return row.revision !== records.profiles.get(botId).revision;
    },
    titleApplied: (botId: string, revision: number) =>
      db
        .prepare(
          "UPDATE bot_setup SET title_revision=? WHERE bot_id=? AND EXISTS(SELECT 1 FROM bots WHERE id=? AND revision=?)",
        )
        .run(revision, botId, botId, revision),
  };
}
export type SetupStore = ReturnType<typeof openSetup>;
export const newRequestId = () => randomUUID();
