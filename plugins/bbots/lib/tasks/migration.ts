import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema, idSchema } from "../storage/schema.ts";
import { tasksClient } from "./client.ts";
import { hashSchema, taskFilesContract } from "./contracts.ts";
import { sourceSchema, type SourceStore } from "./source-store.ts";

const requestSchema = changeSchema.extend({
  botId: idSchema,
  expectedRevision: z.number().int().positive(),
  requestId: z.uuid(),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("tasks"), boardId: idSchema }),
    z.strictObject({ kind: z.literal("markdown"), expectedHash: hashSchema }),
  ]),
  mapping: z
    .array(
      z.strictObject({
        from: z.string().trim().min(1).max(512),
        to: z.string().trim().min(1).max(512),
      }),
    )
    .min(1)
    .max(20),
  evidence: z.string().trim().min(1).max(2048),
});
const recordSchema = z.strictObject({
  request: requestSchema,
  from: sourceSchema,
  to: sourceSchema,
  sourceRevision: z.number().int().positive(),
});
export type MigrationRequest = z.infer<typeof requestSchema>;

export function createMigration(
  bb: BbPluginApi,
  store: SetupStore,
  journal: SourceStore,
  lifecycle: AbortSignal,
  changed: () => void,
) {
  const client = tasksClient(bb, lifecycle);
  const host = bb.hosts.experimental_client({ contract: taskFilesContract });
  function name(id: string) {
    return `TASKS-MIGRATION:${z.uuid().parse(id)}.json`;
  }
  function read(botId: string, id: string) {
    store.get(botId);
    const doc = store.documents.get(botId, name(id));
    if (!doc) throw new Error("Migration receipt was not found for this bot.");
    return recordSchema.parse(JSON.parse(doc.markdown));
  }
  function replay(input: MigrationRequest) {
    if (!store.documents.get(input.botId, name(input.requestId))) return null;
    const migration = read(input.botId, input.requestId);
    if (JSON.stringify(migration.request) !== JSON.stringify(input))
      throw new Error(
        "Migration request ID already records different options. Inspect its original receipt.",
      );
    return { current: journal.read(input.botId), migration, replay: true };
  }
  function signal(request?: AbortSignal) {
    return AbortSignal.any([
      lifecycle,
      ...(request ? [request] : []),
      AbortSignal.timeout(5000),
    ]);
  }
  return {
    read,
    async confirm(input: MigrationRequest, request?: AbortSignal) {
      const value = requestSchema.parse(input);
      const operation = signal(request);
      operation.throwIfAborted();
      const prior = replay(value);
      if (prior) return prior;
      const before = journal.fresh(value);
      if (before.source?.phase !== "ready")
        throw new Error(
          "Only an established ready authority can be migrated. Reconcile incomplete setup first.",
        );
      let target: z.infer<typeof sourceSchema>;
      if (value.target.kind === "tasks") {
        const boardId = value.target.boardId;
        if (before.source.kind === "tasks" && before.source.boardId === boardId)
          throw new Error(
            "The destination is already authoritative; no migration is needed.",
          );
        if (
          !(await client.list(operation)).some((board) => board.id === boardId)
        )
          throw new Error(
            "The destination Tasks board is unavailable. No authority change was saved.",
          );
        target = {
          kind: "tasks",
          phase: "ready",
          boardId,
          migrationId: value.requestId,
        };
      } else {
        if (before.source.kind === "markdown")
          throw new Error(
            "The original home-host Markdown file is already authoritative.",
          );
        const setup = store.get(value.botId);
        if (!setup.homePath)
          throw new Error(
            "Restore the original bot home before confirming a Markdown destination.",
          );
        // Read only: the user/agent must prepare and inspect this file first.
        const file = await host.call(
          "tasksRead",
          { botId: value.botId, path: setup.homePath },
          {
            hostId: setup.request.hostId,
            signal: operation,
            timeoutMs: 5000,
          },
        );
        if (file.hash !== value.target.expectedHash)
          throw new Error(
            "The prepared destination changed. Inspect its contents and mapping again; no authority change was saved.",
          );
        target = {
          kind: "markdown",
          phase: "ready",
          hostId: setup.request.hostId,
          homePath: setup.homePath,
          path: file.path,
          requestId: value.requestId,
          migrationId: value.requestId,
        };
      }
      operation.throwIfAborted();
      const result = bb.storage
        .database()
        .transaction(() => {
          const duplicate = replay(value);
          if (duplicate) return duplicate;
          const current = journal.fresh(value);
          const migration = recordSchema.parse({
            request: value,
            from: current.source,
            to: target,
            sourceRevision: current.revision + 1,
          });
          store.documents.write({
            botId: value.botId,
            name: name(value.requestId),
            expectedRevision: 0,
            markdown: JSON.stringify(migration),
            author: value.author,
            reason: value.reason,
          });
          store.documents.write({
            botId: value.botId,
            name: "TASKS.json",
            expectedRevision: value.expectedRevision,
            markdown: JSON.stringify(target),
            author: value.author,
            reason: value.reason,
          });
          return {
            current: journal.read(value.botId),
            migration,
            replay: false,
          };
        })
        .immediate();
      changed();
      return result;
    },
  };
}
