import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import {
  defaultsSchema,
  defaultsWriteSchema,
  soulStateSchema,
  soulWriteSchema,
} from "./contracts.ts";

const suppliedSchema = z.object({
  revision: z.number(),
  suppliedAt: z.string(),
});
export function openSoul(storage: PluginStorage, store: SetupStore) {
  const db = storage.database();
  function defaults(botId: string) {
    const setup = store.get(botId);
    const doc = store.documents.get(botId, "EXECUTION.json");
    const value = doc
      ? defaultsSchema.parse(JSON.parse(doc.markdown))
      : defaultsSchema.parse({
          main: {
            ...(setup.request.providerId
              ? { providerId: setup.request.providerId }
              : {}),
            ...(setup.request.model ? { model: setup.request.model } : {}),
            ...(setup.request.reasoningLevel
              ? { reasoningLevel: setup.request.reasoningLevel }
              : {}),
            ...(setup.request.permissionMode
              ? { permissionMode: setup.request.permissionMode }
              : {}),
          },
          worker: null,
          fallback: null,
        });
    return {
      revision: doc?.revision ?? 0,
      defaults: value,
      effectiveWorker: value.worker === null ? value.main : value.worker,
      scope: "future-conversations" as const,
      automaticFallback: "disabled" as const,
    };
  }
  function show(botId: string) {
    const view = store.view(botId);
    const row = db
      .prepare(
        "SELECT revision, supplied_at AS suppliedAt FROM soul_supplied WHERE thread_id = ?",
      )
      .get(view.main.threadId);
    const supplied = row ? suppliedSchema.parse(row) : null;
    const current = store.documents.get(botId, "SOUL.md");
    return soulStateSchema.parse({
      current,
      lastSuppliedRevision: supplied?.revision ?? null,
      lastSuppliedAt: supplied?.suppliedAt ?? null,
      appliedRevision: null,
      pending: !supplied
        ? "not-supplied"
        : supplied.revision !== current?.revision
          ? "newer-revision"
          : "unverified",
      limitation:
        "Configuration resolution is not a provider-session receipt. Applied revision is unknown; live sessions may retain earlier guidance. No refresh or turn is started by editing.",
    });
  }
  return {
    show,
    defaults,
    update: (input: z.infer<typeof soulWriteSchema>) => {
      const value = soulWriteSchema.parse(input);
      store.get(value.botId);
      store.documents.write({ ...value, name: "SOUL.md" });
      return show(value.botId);
    },
    updateDefaults: (input: z.infer<typeof defaultsWriteSchema>) => {
      const value = defaultsWriteSchema.parse(input);
      store.get(value.botId);
      store.documents.write({
        botId: value.botId,
        name: "EXECUTION.json",
        expectedRevision: value.expectedRevision,
        markdown: JSON.stringify(value.defaults),
        author: value.author,
        reason: value.reason,
      });
      return defaults(value.botId);
    },
    supply: (threadId: string) => {
      const owner = store.conversations.ownerOfThread(threadId);
      if (!owner) return null;
      const bot = store.profiles.get(owner.botId);
      const doc = store.documents.get(bot.id, "SOUL.md");
      if (!doc || !doc.markdown.trim() || doc.markdown.length > 16000)
        return {
          tools: [],
          skills: ["bbots"],
          instructions:
            "Your soul is unavailable. Ask the user to repair SOUL.md before executing assignments.",
        };
      db.prepare(
        `INSERT INTO soul_supplied (thread_id,revision,supplied_at) VALUES (?,?,?)
        ON CONFLICT(thread_id) DO UPDATE SET revision=excluded.revision,supplied_at=excluded.supplied_at
        WHERE soul_supplied.revision <> excluded.revision`,
      ).run(threadId, doc.revision, new Date().toISOString());
      return {
        tools: [],
        skills: ["bbots", "bbots-soul"],
        instructions: `Your persistent bot identity is ${JSON.stringify(bot.name)} (bot ID ${bot.id}, logical conversation ${owner.id}, role ${owner.role}). SOUL.md revision ${doc.revision} was supplied for this configuration resolution; this is not proof that an existing session refreshed. Native per-thread Stop must not be treated as permission to resume canceled work. Pull current state with bb bot brief ${bot.id}; volatile state is not freshly injected.\n\n${doc.markdown}`,
      };
    },
  };
}
export type SoulStore = ReturnType<typeof openSoul>;
