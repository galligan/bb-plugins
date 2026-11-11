import {
  type BbPluginApi,
  experimental_PluginRpcRefusal,
} from "@get-bb/plugin-sdk";
import {
  createSchema,
  homeContract,
  type CreateBotInput,
} from "./contracts.ts";
import type { SetupStore } from "./storage.ts";
import type { SoulStore } from "../soul/store.ts";

export function createSetupService(
  bb: BbPluginApi,
  store: SetupStore,
  signal: AbortSignal,
  execution: SoulStore["defaults"],
  changed: () => void,
) {
  const host = bb.hosts.experimental_client({ contract: homeContract });
  const active = new Set<string>();
  async function inspect(botId: string, operationSignal: AbortSignal = signal) {
    const setup = store.get(botId);
    const machine = await bb.sdk.hosts.get({
      hostId: setup.request.hostId,
      signal: operationSignal,
    });
    if (machine.status !== "connected")
      throw new Error(
        "Bot machine is offline. Reconnect that machine, then resume this bot; its home will not be replaced.",
      );
    if (setup.homePath) {
      const result = await host.call(
        "inspect",
        { botId, path: setup.homePath },
        { hostId: machine.id, signal: operationSignal, timeoutMs: 5000 },
      );
      if (result.status !== "present")
        throw new Error(
          `Bot home is ${result.status}. Restore the original home and marker, then resume; Bots will not recreate or delete it.`,
        );
    }
    return setup;
  }
  async function finishTitle(
    botId: string,
    operationSignal: AbortSignal = signal,
  ) {
    for (let attempt = 0; attempt < 2 && store.titlePending(botId); attempt++) {
      const view = store.view(botId);
      if (!view.main.threadId) return;
      await bb.sdk.threads.update({
        threadId: view.main.threadId,
        title: `@${view.bot.name}`,
      });
      operationSignal.throwIfAborted();
      store.titleApplied(botId, view.bot.revision);
    }
    if (store.titlePending(botId))
      throw new Error(
        "Bot was renamed again while updating its title. Resume to apply the latest name.",
      );
  }
  async function resume(botId: string, requestSignal?: AbortSignal) {
    const operationSignal = requestSignal
      ? AbortSignal.any([signal, requestSignal])
      : signal;
    operationSignal.throwIfAborted();
    if (active.has(botId)) return store.view(botId);
    active.add(botId);
    try {
      let setup = await inspect(botId, operationSignal);
      if (setup.phase === "planned") {
        const home = await host.call(
          "prepare",
          {
            botId,
            ...(setup.request.homeBase ? { base: setup.request.homeBase } : {}),
          },
          {
            hostId: setup.request.hostId,
            signal: operationSignal,
            timeoutMs: 10000,
          },
        );
        operationSignal.throwIfAborted();
        store.setHome(botId, home.path);
        setup = store.get(botId);
      }
      if (setup.phase === "project-creating")
        throw new Error(
          "Project creation outcome is uncertain. No unrecorded project will be adopted or duplicated. Inspect the original native project request before further recovery.",
        );
      if (setup.phase === "home-ready") {
        const projects = await bb.sdk.projects.list({
          signal: operationSignal,
        });
        if (
          projects.some((p) =>
            p.sources.some(
              (source) =>
                source.hostId === setup.request.hostId &&
                source.path === setup.homePath,
            ),
          )
        )
          throw new Error(
            "A pre-existing BB project points at this bot home. Bots will not adopt an unrelated project. Resolve that source conflict before resuming.",
          );
        operationSignal.throwIfAborted();
        store.phase(botId, "home-ready", "project-creating");
        const project = await bb.sdk.projects.create({
          name: `Bots: ${store.profiles.get(botId).name}`,
          source: {
            type: "local_path",
            hostId: setup.request.hostId,
            path: setup.homePath!,
          },
        });
        operationSignal.throwIfAborted();
        store.setProject(botId, project.id);
        setup = store.get(botId);
      }
      if (setup.phase === "project-ready") {
        store.phase(botId, "project-ready", "spawning");
        const thread = await bb.sdk.threads.spawn({
          projectId: setup.projectId!,
          environment: {
            type: "host",
            hostId: setup.request.hostId,
            workspace: { type: "unmanaged", path: setup.homePath },
          },
          title: `@${store.profiles.get(botId).name}`,
          pinned: true,
          parentNotifications: "off",
          pluginMetadata: { botId, requestId: setup.requestId },
          pluginSubmission: {
            pluginId: bb.pluginId,
            data: { botId, requestId: setup.requestId },
          },
          ...execution(botId).defaults.main,
          prompt:
            "Introduce yourself briefly as this persistent collaborator, without tools, then wait for the user's next request. Do not create tasks, workers or background work during this setup acknowledgement.",
        });
        operationSignal.throwIfAborted();
        const owner = store.conversations.ownerOfThread(thread.id);
        if (!owner || owner.botId !== botId)
          throw new Error(
            "Main creation did not reach verified ownership admission. The pending thread will not be automatically adopted or replaced.",
          );
        setup = store.get(botId);
      }
      if (setup.phase === "spawning")
        throw new Error(
          "Main creation outcome is uncertain. No duplicate was spawned. Reconcile the original request before retrying.",
        );
      if (setup.phase === "owned" || setup.phase === "ready") {
        const view = store.view(botId);
        let thread;
        try {
          thread = await bb.sdk.threads.get({ threadId: view.main.threadId! });
        } catch {
          throw new Error(
            "Recorded main conversation is unavailable. Preserve its home and reconcile the original native thread; Bots will not spawn a replacement.",
          );
        }
        operationSignal.throwIfAborted();
        if (thread.deletedAt !== null || thread.projectId !== setup.projectId)
          throw new Error(
            "Recorded main was removed or moved from its home project. Restore the original conversation through supported recovery; Bots will not spawn a replacement.",
          );
        if (setup.phase === "owned" && thread.title === `@${view.bot.name}`)
          store.titleApplied(botId, view.bot.revision);
        await finishTitle(botId, operationSignal);
        if (setup.phase === "owned") store.phase(botId, "owned", "ready");
      }
      store.fail(botId, null);
      return store.view(botId);
    } catch (error) {
      if (operationSignal.aborted) throw error;
      store.fail(
        botId,
        error instanceof Error
          ? error.message
          : "Bot setup failed. Resume after resolving the unavailable resource.",
      );
      return store.view(botId);
    } finally {
      active.delete(botId);
      changed();
    }
  }
  return {
    inspect,
    resume,
    create: async (input: CreateBotInput, requestSignal?: AbortSignal) => {
      input = createSchema.parse(input);
      const operationSignal = requestSignal
        ? AbortSignal.any([signal, requestSignal])
        : signal;
      operationSignal.throwIfAborted();
      if (!store.findRequest(input.requestId)) {
        try {
          await host.call(
            "validateBase",
            input.homeBase ? { base: input.homeBase } : {},
            { hostId: input.hostId, signal: operationSignal, timeoutMs: 5000 },
          );
        } catch (error) {
          operationSignal.throwIfAborted();
          throw new experimental_PluginRpcRefusal({
            code: "invalid",
            message: `Home validation failed before saving creation intent: ${error instanceof Error ? error.message : "Reconnect the selected machine and check the base."}`,
          });
        }
        operationSignal.throwIfAborted();
      }
      return resume(store.plan(input).botId, requestSignal);
    },
    rename: async (
      input: {
        botId: string;
        expectedRevision: number;
        name: string;
      },
      requestSignal?: AbortSignal,
    ) => {
      signal.throwIfAborted();
      requestSignal?.throwIfAborted();
      store.profiles.rename({
        ...input,
        author: "bbots:rename",
        reason: "Explicit bot rename",
      });
      return resume(input.botId, requestSignal);
    },
  };
}
