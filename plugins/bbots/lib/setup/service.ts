import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { homeContract, type CreateBotInput } from "./contracts.ts";
import type { SetupStore } from "./storage.ts";

export function createSetupService(
  bb: BbPluginApi,
  store: SetupStore,
  signal: AbortSignal,
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
      if (setup.phase === "home-ready" || setup.phase === "project-creating") {
        const projects = await bb.sdk.projects.list();
        const matches = projects.filter((p) =>
          p.sources.some(
            (s) =>
              s.hostId === setup.request.hostId && s.path === setup.homePath,
          ),
        );
        if (matches.length > 1)
          throw new Error(
            "Multiple BB projects point at this bot home. Resolve the duplicate sources before resuming.",
          );
        if (matches.length === 1) store.setProject(botId, matches[0]!.id);
        else {
          if (setup.phase === "project-creating")
            throw new Error(
              "Project creation outcome is uncertain. No second project was created; inspect the original request before retrying.",
            );
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
        }
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
          ...(setup.request.providerId
            ? { providerId: setup.request.providerId }
            : {}),
          ...(setup.request.model ? { model: setup.request.model } : {}),
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
      if (setup.phase === "owned") {
        const view = store.view(botId);
        const thread = await bb.sdk.threads.get({
          threadId: view.main.threadId!,
        });
        if (thread.projectId !== setup.projectId)
          throw new Error(
            "Main conversation no longer belongs to the recorded home project.",
          );
        // The initial pin and title were part of native creation. Never repin on resume.
        if (thread.title === `@${view.bot.name}`)
          store.titleApplied(botId, view.bot.revision);
        await finishTitle(botId, operationSignal);
        store.phase(botId, "owned", "ready");
      } else if (setup.phase === "ready")
        await finishTitle(botId, operationSignal);
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
    }
  }
  return {
    inspect,
    resume,
    create: async (input: CreateBotInput, requestSignal?: AbortSignal) => {
      signal.throwIfAborted();
      requestSignal?.throwIfAborted();
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
