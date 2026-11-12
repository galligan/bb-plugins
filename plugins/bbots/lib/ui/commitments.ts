import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import type { CommitmentStore } from "../commitments/store.ts";
import type { createCommitments } from "../commitments/service.ts";
import { recordIdentity } from "./record-identity.ts";
import { commitmentUiContract } from "./commitment-contracts.ts";

export function createCommitmentInspector(
  storage: PluginStorage,
  store: SetupStore,
  records: CommitmentStore,
  service: ReturnType<typeof createCommitments>,
  lifecycle: AbortSignal,
) {
  function owner(botId: string, conversationId: string) {
    const found = store.conversations.get(conversationId);
    if (found.botId !== botId)
      throw new Error(
        "Commitment owner differs from this bot. Inspect its recorded history.",
      );
    return { conversationId, threadId: found.threadId, role: found.role };
  }
  return {
    list(input: z.input<typeof commitmentUiContract.botCommitments.input>) {
      lifecycle.throwIfAborted();
      const value = commitmentUiContract.botCommitments.input.parse(input);
      return storage.database().transaction(() => {
        const identity = recordIdentity(store, value.threadId),
          page = records.list(identity.botId, value.after, 10);
        return commitmentUiContract.botCommitments.output.parse({
          ...identity,
          records: page.records.map((found) => ({
            id: found.id,
            revision: found.revision,
            owner: owner(identity.botId, found.record.ownerConversationId),
            excerpt: found.record.what.slice(0, 256),
            referenceKind: found.record.reference.kind,
            localStatus:
              found.record.reference.kind === "unlinked"
                ? found.record.reference.status
                : null,
            evidenceCount: found.record.evidence.length,
          })),
          nextCursor: page.nextCursor,
        });
      })();
    },
    async inspect(
      input: z.input<typeof commitmentUiContract.botCommitment.input>,
      signal: AbortSignal,
    ) {
      const value = commitmentUiContract.botCommitment.input.parse(input);
      const operation = AbortSignal.any([
        lifecycle,
        signal,
        AbortSignal.timeout(10_000),
      ]);
      operation.throwIfAborted();
      const identity = recordIdentity(store, value.threadId);
      const found = await service.show(identity.botId, value.id, operation);
      operation.throwIfAborted();
      if (recordIdentity(store, value.threadId).botId !== identity.botId)
        throw new Error(
          "Conversation ownership changed during the read. Inspect its current mapping.",
        );
      return commitmentUiContract.botCommitment.output.parse({
        ...identity,
        id: found.id,
        revision: found.revision,
        owner: owner(identity.botId, found.record.ownerConversationId),
        what: found.record.what,
        evidence: found.record.evidence,
        reference: found.record.reference,
        author: found.author,
        reason: found.reason,
        availability: found.availability,
        authority: found.authority,
        status: found.status,
        task: "task" in found ? found.task : null,
        limitation: "limitation" in found ? found.limitation : null,
        inspectedAt: new Date().toISOString(),
      });
    },
  };
}
