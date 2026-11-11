import type {
  BbPluginApi,
  MessageDispatchHookContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Setup } from "./contracts.ts";
import type { SetupStore } from "./storage.ts";
import type { SoulStore } from "../soul/store.ts";

const lookupSchema = z.object({ botId: z.string(), requestId: z.string() });
export function registerAdmission(
  bb: BbPluginApi,
  store: SetupStore,
  inspect: (botId: string) => Promise<Setup>,
  soul: SoulStore,
) {
  bb.experimental_hooks.on(
    "message.dispatch",
    async (ctx: MessageDispatchHookContext) => {
      let owner = store.conversations.ownerOfThread(ctx.thread.id);
      if (!owner && ctx.originPluginId === bb.pluginId) {
        const raw =
          ctx.experimental_submission?.pluginId === bb.pluginId
            ? ctx.experimental_submission.data
            : await bb.sdk.threads.getPluginMetadata({
                threadId: ctx.thread.id,
              });
        const lookup = lookupSchema.safeParse(raw);
        if (!lookup.success)
          return {
            action: "reject",
            message: "Bots main creation is missing its recorded intent.",
          };
        let setup;
        try {
          setup = store.get(lookup.data.botId);
        } catch {
          return {
            action: "reject",
            message: "Bots main creation has no authoritative SQLite intent.",
          };
        }
        if (
          setup.requestId !== lookup.data.requestId ||
          setup.phase !== "spawning" ||
          setup.projectId !== ctx.project.id ||
          setup.request.hostId !== ctx.host?.id
        )
          return {
            action: "reject",
            message:
              "Bots main creation does not match its recorded intent, project or machine.",
          };
        try {
          store.bind(setup.botId, ctx.thread.id);
          const bot = store.profiles.get(setup.botId);
          if (ctx.thread.title === `@${bot.name}`)
            store.titleApplied(bot.id, bot.revision);
        } catch {
          return {
            action: "reject",
            message:
              "Bots main conversation is already owned or its creation intent changed.",
          };
        }
        owner = store.conversations.ownerOfThread(ctx.thread.id);
      }
      if (!owner) return { action: "proceed" };
      try {
        const setup = await inspect(owner.botId);
        if (
          ctx.project.id !== setup.projectId ||
          ctx.host?.id !== setup.request.hostId ||
          (ctx.environment?.path && ctx.environment.path !== setup.homePath)
        )
          throw new Error(
            "Main conversation environment differs from its recorded home. Restore the original home environment before continuing.",
          );
        const soul = store.documents.get(owner.botId, "SOUL.md");
        if (!soul || !soul.markdown.trim() || soul.markdown.length > 16000)
          throw new Error(
            "SOUL.md is missing or exceeds the 16,000-character session limit. Correct it before starting work.",
          );
        return { action: "proceed" };
      } catch (error) {
        return {
          action: "reject",
          message:
            error instanceof Error
              ? error.message
              : "Bot home could not be verified. Restore it before continuing.",
        };
      }
    },
  );
  bb.agents.configure((ctx) => {
    return soul.supply(ctx.thread.id) ?? { tools: [], skills: [] };
  });
}
