import type {
  MessageDispatchHookContext,
  MessageDispatchHookDecision,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import type { WorkStore } from "./storage.ts";
import type { WorkService } from "./service.ts";

const lookupSchema = z.strictObject({
  kind: z.literal("worker"),
  conversationId: z.string(),
  requestId: z.uuid(),
});
export function createWorkerAdmission(
  store: SetupStore,
  work: WorkStore,
  service: WorkService,
) {
  return async (
    ctx: MessageDispatchHookContext,
    raw: unknown,
  ): Promise<MessageDispatchHookDecision | null> => {
    let owner = store.conversations.ownerOfThread(ctx.thread.id);
    const lookup = lookupSchema.safeParse(raw);
    if (!owner && !lookup.success) return null;
    if (owner && owner.role !== "worker") return null;
    try {
      let admittedEnvironment:
        Awaited<ReturnType<WorkService["environment"]>> | undefined;
      const environmentId =
        ctx.thread.environmentId ??
        ctx.environment?.id ??
        (ctx.environmentIntent?.kind === "environment"
          ? ctx.environmentIntent.environmentId
          : null);
      if (!owner) {
        if (!lookup.success)
          throw new Error("Worker creation is missing its recorded intent.");
        const worker = work.get(lookup.data.conversationId);
        if (
          worker.requestId !== lookup.data.requestId ||
          worker.phase !== "spawning" ||
          ctx.project.id !== worker.request.projectId ||
          environmentId !== worker.request.environmentId
        )
          throw new Error(
            "Worker creation differs from its recorded intent or environment.",
          );
        admittedEnvironment = await service.environment(
          worker.request.projectId,
          worker.request.environmentId,
        );
        if (ctx.host?.id !== admittedEnvironment.hostId)
          throw new Error(
            "Worker admission machine differs from its recorded environment.",
          );
        owner = work.bind(worker.conversationId, ctx.thread.id);
        const bot = store.profiles.get(owner.botId);
        if (ctx.thread.title === `→ @${bot.name} ${worker.request.title}`)
          work.titleApplied(owner.id, bot.revision);
      }
      const worker = work.get(owner.id);
      if (
        ctx.project.id !== worker.request.projectId ||
        environmentId !== worker.request.environmentId
      )
        throw new Error(
          "Owned worker moved from its recorded project or environment. Restore it before continuing.",
        );
      const env =
        admittedEnvironment ??
        (await service.environment(
          worker.request.projectId,
          worker.request.environmentId,
        ));
      if (ctx.host?.id !== env.hostId)
        throw new Error(
          "Worker machine differs from its recorded environment.",
        );
      work.agreement(owner.id);
      const soul = store.documents.get(owner.botId, "SOUL.md");
      if (!soul || !soul.markdown.trim() || soul.markdown.length > 16000)
        throw new Error(
          "SOUL.md is missing or exceeds its session limit. Repair it before executing work.",
        );
      return { action: "proceed" };
    } catch (error) {
      return {
        action: "reject",
        message:
          error instanceof Error
            ? error.message
            : "Worker ownership or environment could not be verified.",
      };
    }
  };
}
