import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { taskFilesContract } from "./contracts.ts";
import type {
  MarkdownSource,
  SourceEdit,
  SourceState,
  SourceStore,
} from "./source-store.ts";

export function createMarkdownSource(
  bb: BbPluginApi,
  store: SetupStore,
  journal: SourceStore,
  lifecycle: AbortSignal,
) {
  const host = bb.hosts.experimental_client({ contract: taskFilesContract });
  function signal(request?: AbortSignal) {
    return AbortSignal.any([
      lifecycle,
      ...(request ? [request] : []),
      AbortSignal.timeout(5000),
    ]);
  }
  function source(botId: string, ready = true): MarkdownSource {
    const current = journal.read(botId).source;
    if (current?.kind !== "markdown" || (ready && current.phase !== "ready"))
      throw new Error(
        "This bot has no ready Markdown task authority. Inspect tasks show; no fallback is inferred.",
      );
    const setup = store.get(botId);
    if (
      setup.homePath !== current.homePath ||
      setup.request.hostId !== current.hostId
    )
      throw new Error(
        "Task authority differs from the original bot home/machine. Restore it before continuing; no local copy is assumed.",
      );
    return current;
  }
  async function read(botId: string, request?: AbortSignal) {
    const current = source(botId);
    const result = await host.call(
      "tasksRead",
      { botId, path: current.homePath },
      { hostId: current.hostId, signal: signal(request), timeoutMs: 5000 },
    );
    if (current.phase !== "ready" || result.path !== current.path)
      throw new Error(
        "The machine returned a different task file. Inspect the recorded authority before continuing.",
      );
    return result;
  }
  async function finish(edit: SourceEdit, request?: AbortSignal) {
    const before = journal.fresh(edit);
    const current = source(edit.botId, false);
    if (current.phase !== "initializing")
      throw new Error(
        "Only an interrupted Markdown initialization can be resumed.",
      );
    try {
      const operation = signal(request);
      const result = await host.call(
        "tasksInitialize",
        {
          botId: edit.botId,
          path: current.homePath,
          requestId: current.requestId,
        },
        { hostId: current.hostId, signal: operation, timeoutMs: 5000 },
      );
      operation.throwIfAborted();
      return journal.write(
        { ...edit, expectedRevision: before.revision },
        { ...current, phase: "ready", path: result.path },
      );
    } catch (error) {
      throw new Error(
        `tasks.md initialization is incomplete or uncertain. Original intent revision ${before.revision} is retained; inspect the recorded machine/home, then explicitly resume. No alternate home or task source was created. ${error instanceof Error ? error.message : "Host request failed."}`,
      );
    }
  }
  return {
    read,
    resume: finish,
    async initialize(input: SourceEdit, request?: AbortSignal) {
      const { edit, source: current } = journal.fresh(input);
      if (current)
        throw new Error(
          "Task authority or an initialization intent already exists. Inspect tasks show; never switch to Markdown during a Tasks outage.",
        );
      const operation = signal(request);
      const inventory = await bb.sdk.plugins.list({ signal: operation });
      if (inventory.plugins.some((plugin) => plugin.id === "tasks"))
        throw new Error(
          "Tasks is installed, even if disabled or unavailable. Select its board or restore it; absence cannot be inferred from an RPC failure.",
        );
      const setup = store.get(edit.botId);
      if (!setup.homePath)
        throw new Error(
          "Prepare the bot's original home before initializing tasks.md.",
        );
      operation.throwIfAborted();
      const planned = journal.write(edit, {
        kind: "markdown",
        phase: "initializing",
        hostId: setup.request.hostId,
        homePath: setup.homePath,
        requestId: randomUUID(),
      });
      return finish({ ...edit, expectedRevision: planned.revision }, request);
    },
    async show(botId: string, current: SourceState, request?: AbortSignal) {
      if (
        current.source?.kind !== "markdown" ||
        current.source.phase !== "ready"
      )
        return {
          ...current,
          availability: "recovery-required",
          limitation:
            "Restore the recorded machine/home and explicitly resume the same tasks.md initialization. No assumed local copy, new source or automatic retry.",
        };
      try {
        const file = await read(botId, request);
        return {
          ...current,
          availability: "available",
          file: { path: file.path, hash: file.hash },
          limitation:
            "Markdown is authoritative; no arbitrary Markdown task counts are inferred. Read/edit through the home-host CLI path.",
        };
      } catch (error) {
        lifecycle.throwIfAborted();
        request?.throwIfAborted();
        return {
          ...current,
          availability: "unavailable",
          error:
            error instanceof Error
              ? error.message.slice(0, 1024)
              : "Home host unavailable",
          limitation:
            "Reconnect the recorded machine or restore the original tasks.md. No fallback, replacement or server-side filesystem access.",
        };
      }
    },
    async write(
      botId: string,
      expectedHash: string,
      markdown: string,
      request?: AbortSignal,
    ) {
      const current = source(botId);
      try {
        return await host.call(
          "tasksWrite",
          { botId, path: current.homePath, expectedHash, markdown },
          { hostId: current.hostId, signal: signal(request), timeoutMs: 5000 },
        );
      } catch (error) {
        throw new Error(
          `Task file edit failed or its receipt is uncertain. Read the actual authoritative file before another edit; Bots did not retry. ${error instanceof Error ? error.message : "Host request failed."}`,
        );
      }
    },
  };
}
