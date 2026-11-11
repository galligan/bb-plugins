import type { SetupStore } from "./setup/storage.ts";
import type { SoulStore } from "./soul/store.ts";
import type { WorkStore } from "./work/storage.ts";
import type { TaskSource } from "./tasks/source.ts";
import type { Commitments } from "./commitments/service.ts";

export function createBrief(
  store: SetupStore,
  soul: SoulStore,
  work: WorkStore,
  tasks: TaskSource,
  commitments: Commitments,
) {
  return async (botId: string, threadId?: string, signal?: AbortSignal) => {
    const view = store.view(botId);
    const owner = threadId ? store.conversations.ownerOfThread(threadId) : null;
    if (owner && owner.botId !== botId)
      throw new Error("Owned caller cannot read another bot's complete brief.");
    const { current, ...state } = soul.show(botId);
    const [taskSource, obligations] = await Promise.all([
      tasks.show(botId, signal),
      commitments.list(botId, undefined, 10, signal),
    ]);
    return {
      ...view,
      soul: { ...state, currentRevision: current?.revision ?? null },
      execution: soul.defaults(botId),
      conversation: owner ?? null,
      contract: owner?.role === "worker" ? work.agreement(owner.id) : null,
      taskSource,
      commitments: obligations.commitments.map(
        ({ id, revision, record, status, availability, authority }) => ({
          id,
          revision,
          ownerConversationId: record.ownerConversationId,
          what: record.what.slice(0, 512),
          reference: record.reference,
          status,
          availability,
          authority,
        }),
      ),
      commitmentsNextCursor: obligations.nextCursor,
      unavailable: [
        ...(taskSource.availability === "available" ? [] : ["tasks"]),
        "memory",
      ],
    };
  };
}
export type Brief = ReturnType<typeof createBrief>;
