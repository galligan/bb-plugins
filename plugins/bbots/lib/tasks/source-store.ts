import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema, idSchema } from "../storage/schema.ts";
import { prefixSchema } from "./client.ts";

const markdown = z.strictObject({
  kind: z.literal("markdown"),
  hostId: idSchema,
  homePath: z.string().min(1).max(4096),
  requestId: z.uuid(),
});
export const sourceSchema = z.union([
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
    migrationId: z.uuid().optional(),
  }),
  markdown.extend({ phase: z.literal("initializing") }),
  markdown.extend({
    phase: z.literal("ready"),
    path: z.string().min(1).max(4096),
    migrationId: z.uuid().optional(),
  }),
]);
const editSchema = changeSchema.extend({
  botId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type SourceEdit = z.infer<typeof editSchema>;
export function createSourceStore(store: SetupStore, changed: () => void) {
  function read(botId: string) {
    store.get(botId);
    const doc = store.documents.get(botId, "TASKS.json");
    return {
      revision: doc?.revision ?? 0,
      source: doc ? sourceSchema.parse(JSON.parse(doc.markdown)) : null,
    };
  }
  return {
    read,
    write(edit: SourceEdit, source: z.infer<typeof sourceSchema>) {
      store.documents.write({
        ...edit,
        name: "TASKS.json",
        markdown: JSON.stringify(sourceSchema.parse(source)),
      });
      changed();
      return read(edit.botId);
    },
    fresh(input: SourceEdit) {
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
    },
  };
}
export type SourceStore = ReturnType<typeof createSourceStore>;
export type SourceState = ReturnType<SourceStore["read"]>;
export type MarkdownSource = Extract<
  NonNullable<SourceState["source"]>,
  { kind: "markdown" }
>;
