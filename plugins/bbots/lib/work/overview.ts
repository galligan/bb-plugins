import { defineRpcContract, type PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema, nameSchema } from "../storage/schema.ts";
import type { SetupStore } from "../setup/storage.ts";
import type { WorkStore } from "./storage.ts";

export const workerOverviewRow = z.strictObject({
  conversationId: idSchema,
  title: nameSchema,
  threadId: idSchema.nullable(),
  phase: z.enum(["planned", "spawning", "bound"]),
  error: z.string().max(1024).nullable(),
  requestedParentThreadId: idSchema.nullable(),
  report: z.strictObject({
    kind: z.enum(["conversation", "thread"]),
    threadId: idSchema.nullable(),
    isOwnMain: z.boolean(),
    revision: z.number().int().positive(),
  }),
});
export type WorkerOverviewRow = z.infer<typeof workerOverviewRow>;
export const workerOverviewContract = defineRpcContract({
  workerOverview: {
    input: z.strictObject({
      botId: idSchema,
      offset: z.number().int().min(0).max(90).multipleOf(10).default(0),
    }),
    output: z.strictObject({
      botId: idSchema,
      offset: z.number().int().nonnegative(),
      workers: z.array(workerOverviewRow).max(10),
      nextOffset: z.number().int().nonnegative().nullable(),
      hasMoreBeyondLimit: z.boolean(),
    }),
    tags: () => ["bots"],
  },
});

export function createWorkerOverview(
  storage: PluginStorage,
  store: SetupStore,
  work: WorkStore,
) {
  return (input: { botId: string; offset?: number }) => {
    const { botId, offset } =
      workerOverviewContract.workerOverview.input.parse(input);
    return storage.database().transaction(() => {
      const list = work.list(botId);
      const main = store.view(botId).main.id;
      return workerOverviewContract.workerOverview.output.parse({
        botId,
        offset,
        workers: list.workers.slice(offset, offset + 10).map((worker) => {
          const setup = work.get(worker.conversation.id);
          const contract = work.agreement(worker.conversation.id);
          const target = contract.agreement.reportTo;
          return {
            conversationId: worker.conversation.id,
            title: worker.title,
            threadId: worker.conversation.threadId,
            phase: worker.phase,
            error: worker.error?.slice(0, 1024) ?? null,
            requestedParentThreadId: setup.request.parentThreadId ?? null,
            report: {
              kind: target.kind,
              threadId:
                target.kind === "thread"
                  ? target.threadId
                  : store.conversations.get(target.conversationId).threadId,
              isOwnMain:
                target.kind === "conversation" &&
                target.conversationId === main,
              revision: contract.revision,
            },
          };
        }),
        nextOffset: offset + 10 < list.workers.length ? offset + 10 : null,
        hasMoreBeyondLimit: list.hasMore,
      });
    })();
  };
}
