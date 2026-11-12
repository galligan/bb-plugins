import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { idSchema } from "../storage/schema.ts";
import { prefixSchema, tasksClient, type Board } from "./client.ts";
import { createSourceStore, type SourceEdit as Edit } from "./source-store.ts";
import { createMarkdownSource } from "./markdown-source.ts";
import { createMigration } from "./migration.ts";

export function createTaskSource(
  bb: BbPluginApi,
  store: SetupStore,
  lifecycle: AbortSignal,
  changed: () => void,
) {
  const client = tasksClient(bb, lifecycle);
  const journal = createSourceStore(store, changed);
  const { read, write, fresh } = journal;
  const markdown = createMarkdownSource(bb, store, journal, lifecycle);
  function checkSignal(signal?: AbortSignal) {
    lifecycle.throwIfAborted();
    signal?.throwIfAborted();
  }
  async function board(id: string, signal?: AbortSignal): Promise<Board> {
    idSchema.parse(id);
    const found = (await client.list(signal)).find((value) => value.id === id);
    if (!found) throw new Error("Tasks board is unavailable or removed.");
    return found;
  }
  return {
    read,
    migration: createMigration(bb, store, journal, lifecycle, changed),
    markdownInitialize: markdown.initialize,
    markdownResume: markdown.resume,
    markdownRead: markdown.read,
    markdownWrite: markdown.write,
    async show(botId: string, signal?: AbortSignal) {
      const current = read(botId);
      function changedDuringRead() {
        const latest = read(botId);
        return latest.revision === current.revision
          ? null
          : {
              ...latest,
              availability: "changed-during-read",
              limitation:
                "Task authority changed while its source was responding. Read it again deliberately; this response makes no availability claim about the new source.",
            };
      }
      if (!current.source)
        return {
          ...current,
          availability: "unconfigured",
          limitation:
            "Choose a stable Tasks board explicitly, or initialize tasks.md only when Tasks is absent at this initial source choice. No source is assumed.",
        };
      if (current.source.kind === "markdown") {
        const result = await markdown.show(botId, current, signal);
        checkSignal(signal);
        return changedDuringRead() ?? result;
      }
      if (current.source.phase === "creating")
        return {
          ...current,
          availability: "recovery-required",
          limitation:
            "Creation outcome is uncertain. Inspect Tasks for the recorded prefix, then explicitly recover with its stable board ID. No automatic adoption or duplicate creation.",
        };
      try {
        const found = await board(current.source.boardId, signal);
        checkSignal(signal);
        return (
          changedDuringRead() ?? {
            ...current,
            availability: "available",
            board: found,
          }
        );
      } catch (error) {
        checkSignal(signal);
        return (
          changedDuringRead() ?? {
            ...current,
            availability: "unavailable",
            error:
              error instanceof Error
                ? error.message.slice(0, 1024)
                : "Tasks unavailable",
            limitation:
              "The configured board remains authoritative. Reconnect Tasks or restore that board; no Markdown fallback or replacement was created.",
          }
        );
      }
    },
    async select(input: Edit & { boardId: string }, signal?: AbortSignal) {
      const { edit, source } = fresh(input);
      if (source)
        throw new Error(
          "Task authority is already recorded. Use explicit recovery for an interrupted creation; changing a ready source requires a separate assisted migration.",
        );
      const target = await board(input.boardId, signal);
      checkSignal(signal);
      return write(edit, { kind: "tasks", phase: "ready", boardId: target.id });
    },
    async create(input: Edit & { prefix: string }, signal?: AbortSignal) {
      const { edit, source } = fresh(input);
      if (source)
        throw new Error(
          "Task authority or a creation intent is already recorded. No additional board was requested; inspect tasks show.",
        );
      const prefix = prefixSchema.parse(input.prefix);
      if ((await client.list(signal)).some((value) => value.prefix === prefix))
        throw new Error(
          "Tasks prefix is already in use. Select its board explicitly or choose an unused prefix.",
        );
      checkSignal(signal);
      const name = `Bots: ${store.profiles.get(edit.botId).name}`;
      const intent = write(edit, {
        kind: "tasks",
        phase: "creating",
        name,
        prefix,
      });
      try {
        const created = await client.create(name, prefix, signal);
        checkSignal(signal);
        if (created.prefix !== prefix || created.name !== name)
          throw new Error(
            "Tasks returned a board that differs from the recorded creation intent.",
          );
        return write(
          { ...edit, expectedRevision: intent.revision },
          { kind: "tasks", phase: "ready", boardId: created.id },
        );
      } catch (error) {
        throw new Error(
          `Board creation outcome is uncertain; intent revision ${intent.revision} is retained. Inspect Tasks and recover by stable ID before any further creation. Bots did not retry. ${error instanceof Error ? error.message : "Request failed."}`,
        );
      }
    },
    async recover(input: Edit & { boardId: string }, signal?: AbortSignal) {
      const { edit, source } = fresh(input);
      if (source?.phase !== "creating")
        throw new Error(
          "Only an interrupted recorded board creation can be recovered.",
        );
      const target = await board(input.boardId, signal);
      if (target.prefix !== source.prefix)
        throw new Error(
          "Selected board does not match the recorded prefix. Preserve both sources and inspect before proceeding.",
        );
      checkSignal(signal);
      return write(edit, { kind: "tasks", phase: "ready", boardId: target.id });
    },
  };
}
export type TaskSource = ReturnType<typeof createTaskSource>;
