import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema, idSchema } from "../storage/schema.ts";
import { prefixSchema, tasksClient, type Board } from "./client.ts";

const sourceSchema = z.discriminatedUnion("phase", [
  z.strictObject({
    kind: z.literal("tasks"),
    phase: z.literal("creating"),
    name: z.string().min(1).max(512),
    prefix: prefixSchema,
  }),
  z.strictObject({
    kind: z.literal("tasks"),
    phase: z.literal("ready"),
    boardId: idSchema,
  }),
]);
const editSchema = changeSchema.extend({
  botId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
type Edit = z.infer<typeof editSchema>;

export function createTaskSource(
  bb: BbPluginApi,
  store: SetupStore,
  lifecycle: AbortSignal,
  changed: () => void,
) {
  const client = tasksClient(bb, lifecycle);
  function read(botId: string) {
    store.get(botId);
    const doc = store.documents.get(botId, "TASKS.json");
    return {
      revision: doc?.revision ?? 0,
      source: doc ? sourceSchema.parse(JSON.parse(doc.markdown)) : null,
    };
  }
  function write(edit: Edit, source: z.infer<typeof sourceSchema>) {
    store.documents.write({
      ...edit,
      name: "TASKS.json",
      markdown: JSON.stringify(sourceSchema.parse(source)),
    });
    changed();
    return read(edit.botId);
  }
  function fresh(input: Edit) {
    const edit = editSchema.parse({
      botId: input.botId,
      expectedRevision: input.expectedRevision,
      author: input.author,
      reason: input.reason,
    });
    const current = read(edit.botId);
    if (current.revision !== edit.expectedRevision)
      throw new Error("Task source changed. Read tasks show before editing.");
    return { edit, ...current };
  }
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
    async show(botId: string, signal?: AbortSignal) {
      const current = read(botId);
      if (!current.source)
        return {
          ...current,
          availability: "unconfigured",
          limitation:
            "Choose a stable Tasks board explicitly. Initial absent-Tasks Markdown setup is not implemented in this slice; no source is assumed.",
        };
      if (current.source.phase === "creating")
        return {
          ...current,
          availability: "recovery-required",
          limitation:
            "Creation outcome is uncertain. Inspect Tasks for the recorded prefix, then explicitly recover with its stable board ID. No automatic adoption or duplicate creation.",
        };
      try {
        return {
          ...current,
          availability: "available",
          board: await board(current.source.boardId, signal),
        };
      } catch (error) {
        checkSignal(signal);
        return {
          ...current,
          availability: "unavailable",
          error: error instanceof Error ? error.message : "Tasks unavailable",
          limitation:
            "The configured board remains authoritative. Reconnect Tasks or restore that board; no Markdown fallback or replacement was created.",
        };
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
