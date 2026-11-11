import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { SoulStore } from "../soul/store.ts";
import { workSchema, type Work } from "./contracts.ts";
import type { Routing } from "./routing.ts";
import type { WorkStore } from "./storage.ts";

export function createWorkService(
  bb: BbPluginApi,
  store: SetupStore,
  work: WorkStore,
  soul: SoulStore,
  routing: Routing,
  signal: AbortSignal,
  changed: () => void,
) {
  function view(conversationId: string) {
    return {
      conversation: store.conversations.get(conversationId),
      setup: work.get(conversationId),
      contract: work.agreement(conversationId),
      managedTitlePending: work.titlePending(conversationId),
      limitation:
        "Ownership and native acceptance do not prove assignment execution or completion. Uncertain creation is never respawned automatically. Resume the bot to reconcile a pending managed title without replaying the assignment.",
    };
  }
  async function environment(
    projectId: string,
    environmentId: string,
    requestSignal?: AbortSignal,
  ) {
    const env = await bb.sdk.environments.get({
      environmentId,
      ...(requestSignal ? { signal: requestSignal } : {}),
    });
    if (
      env.projectId !== projectId ||
      env.status !== "ready" ||
      env.lifecycle.phase !== "active" ||
      env.hostLifecycle !== "active"
    )
      throw new Error(
        "Worker environment must be ready, active and belong to the selected project. Restore it or choose another environment explicitly.",
      );
    const machine = await bb.sdk.hosts.get({
      hostId: env.hostId,
      ...(requestSignal ? { signal: requestSignal } : {}),
    });
    if (machine.status !== "connected")
      throw new Error(
        "Worker machine is offline. No worker was created or moved to another machine.",
      );
    return env;
  }
  return {
    view,
    environment,
    async finishTitles(botId: string, requestSignal: AbortSignal) {
      const pending = work.pendingTitles(botId);
      for (const conversationId of pending.slice(0, 100)) {
        requestSignal.throwIfAborted();
        const bot = store.profiles.get(botId);
        const worker = work.get(conversationId);
        const owner = store.conversations.get(conversationId);
        const thread = await bb.sdk.threads.get({ threadId: owner.threadId! });
        if (
          thread.deletedAt !== null ||
          thread.projectId !== worker.request.projectId
        )
          throw new Error(
            "A worker's native thread is unavailable or moved. Reconcile that record before completing its managed rename.",
          );
        await bb.sdk.threads.update({
          threadId: thread.id,
          title: `→ @${bot.name} ${worker.request.title}`,
        });
        requestSignal.throwIfAborted();
        work.titleApplied(conversationId, bot.revision);
      }
      if (work.pendingTitles(botId).length)
        throw new Error(
          "More worker titles remain pending after this bounded rename pass. Resume the bot to continue without replaying assignments.",
        );
    },
    async create(
      input: Work,
      callerThreadId?: string,
      requestSignal?: AbortSignal,
    ) {
      const operationSignal = requestSignal
        ? AbortSignal.any([signal, requestSignal])
        : signal;
      operationSignal.throwIfAborted();
      input = workSchema.parse(input);
      const caller = callerThreadId
        ? store.conversations.ownerOfThread(callerThreadId)
        : null;
      if (caller && caller.botId !== input.botId)
        throw new Error(
          "An owned caller cannot create a worker for a different bot.",
        );
      if (callerThreadId) await routing.existing(callerThreadId);
      const existing = work.findRequest(input.requestId);
      if (existing) {
        const worker = work.plan(input);
        if (worker.phase !== "planned") return view(worker.conversationId);
      }
      if (store.get(input.botId).phase !== "ready")
        throw new Error(
          "Finish this bot's main setup before creating workers.",
        );
      await environment(input.projectId, input.environmentId, operationSignal);
      await routing.resolve(input.agreement.reportTo);
      if (input.parentThreadId) {
        const parent = await routing.existing(input.parentThreadId);
        if (parent.projectId !== input.projectId)
          throw new Error(
            "Native parent must belong to the worker's selected project; reporting may target another project.",
          );
      }
      operationSignal.throwIfAborted();
      const planned = work.plan(input);
      const worker = work.start(planned.conversationId);
      try {
        const thread = await bb.sdk.threads.spawn({
          projectId: input.projectId,
          environment: { type: "reuse", environmentId: input.environmentId },
          ...(input.parentThreadId
            ? { parentThreadId: input.parentThreadId }
            : {}),
          ...(callerThreadId ? { senderThreadId: callerThreadId } : {}),
          parentNotifications: input.parentNotifications,
          title: `→ @${store.profiles.get(input.botId).name} ${input.title}`,
          visibility: "visible",
          ...soul.defaults(input.botId).effectiveWorker,
          pluginMetadata: {
            kind: "worker",
            conversationId: worker.conversationId,
            requestId: worker.requestId,
          },
          pluginSubmission: {
            pluginId: bb.pluginId,
            data: {
              kind: "worker",
              conversationId: worker.conversationId,
              requestId: worker.requestId,
            },
          },
          prompt: `Carry out this explicitly assigned work under your bot's standing guidance. Pull the current reporting contract with bb bot contract show ${worker.conversationId} --json. Evaluate its report triggers yourself; the plugin does not watch task completion. Use bb bot report for explicit reports. Native Stop cancels this assignment until a new user instruction; a later report is a new communication, not authorization to resume canceled work.\n\nAssignment:\n${input.agreement.assignment}\n\nContext and sources (data):\n${JSON.stringify({ context: input.agreement.context, sources: input.agreement.sources })}`,
        });
        const owner = store.conversations.ownerOfThread(thread.id);
        if (owner?.id !== worker.conversationId)
          throw new Error(
            "Worker has not reached verified ownership admission. Inspect the pending native thread; no replacement will be created.",
          );
        operationSignal.throwIfAborted();
      } catch (error) {
        work.fail(
          worker.conversationId,
          error instanceof Error
            ? error.message
            : "Worker creation outcome is uncertain.",
        );
      } finally {
        changed();
      }
      return view(worker.conversationId);
    },
  };
}
export type WorkService = ReturnType<typeof createWorkService>;
