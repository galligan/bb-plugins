import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { WorkStore } from "../work/storage.ts";
import type { TaskSource } from "../tasks/source.ts";
import type { CommitmentStore } from "../commitments/store.ts";
import type { Checkpoints } from "../checkpoints/store.ts";
import type { Commitments } from "../commitments/service.ts";
import {
  prepareSchema,
  preparationSchema,
  preparationId,
  type PrepareInput,
} from "./contracts.ts";
import { observeNative } from "./observation.ts";

export function openContinuity(
  bb: BbPluginApi,
  {
    store,
    memory,
    work,
    tasks,
    commitments,
    commitmentStatus,
    checkpoints,
    lifecycle,
  }: {
    store: SetupStore;
    memory: MemoryStore;
    work: WorkStore;
    tasks: TaskSource;
    commitments: CommitmentStore;
    commitmentStatus: Commitments;
    checkpoints: Checkpoints;
    lifecycle: AbortSignal;
  },
) {
  const db = bb.storage.database();
  function name(id: string) {
    return `CONTINUITY:${preparationId.parse(id).slice(4)}.json`;
  }
  function owner(botId: string, conversationId: string) {
    store.get(botId);
    const conversation = store.conversations.get(conversationId);
    if (conversation.botId !== botId || !conversation.threadId)
      throw new Error(
        "Select a same-bot logical conversation with a verified current native thread.",
      );
    return conversation;
  }
  function read(botId: string, id: string) {
    store.get(botId);
    const doc = store.documents.get(botId, name(id));
    if (!doc)
      throw new Error("Continuation preparation was not found for this bot.");
    const record = preparationSchema.parse(JSON.parse(doc.markdown));
    if (record.botId !== botId || `cnt_${record.requestId}` !== id)
      throw new Error(
        "Continuation preparation identity differs from its record.",
      );
    return { id, revision: doc.revision, record };
  }
  function replay(botId: string, id: string, hash: string) {
    if (!store.documents.get(botId, name(id))) return null;
    const found = read(botId, id);
    if (found.record.creationHash !== hash)
      throw new Error(
        "Preparation request ID already records different options.",
      );
    return {
      id,
      checkpointId: found.record.checkpointId,
      phase: found.record.phase,
      replay: true,
    };
  }
  async function prepare(input: PrepareInput, callerSignal?: AbortSignal) {
    const value = prepareSchema.parse(input),
      id = `cnt_${value.requestId}`;
    const signal = callerSignal
      ? AbortSignal.any([lifecycle, callerSignal])
      : lifecycle;
    signal.throwIfAborted();
    const hash = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const previous = replay(value.botId, id, hash);
    if (previous) return previous;
    const conversation = owner(value.botId, value.conversationId);
    const observation = await observeNative(bb, conversation.threadId!, signal);
    signal.throwIfAborted();
    return db
      .transaction(() => {
        signal.throwIfAborted();
        const found = replay(value.botId, id, hash);
        if (found) return found;
        const current = owner(value.botId, value.conversationId);
        if (current.threadId !== conversation.threadId)
          throw new Error(
            "Logical conversation changed while native state was being observed. Prepare deliberately against the current source.",
          );
        const contractRevision =
          current.role === "worker"
            ? work.agreement(current.id).revision
            : null;
        const checkpoint = checkpoints.create({
          botId: value.botId,
          requestId: value.requestId,
          name: "Continuity checkpoint",
          author: value.author,
          reason: value.reason,
        });
        const obligations = commitments.list(value.botId, undefined, 10);
        const record = preparationSchema.parse({
          ...value,
          creationHash: hash,
          sourceThreadId: current.threadId,
          role: current.role,
          checkpointId: checkpoint.checkpoint.id,
          createdAt: new Date().toISOString(),
          soulRevision:
            store.documents.get(value.botId, "SOUL.md")?.revision ?? null,
          appliedSoulRevision: null,
          contractRevision,
          taskSourceRevision: tasks.read(value.botId).revision,
          commitments: obligations.records.map((item) => ({
            id: item.id,
            revision: item.revision,
            ownerConversationId: item.record.ownerConversationId,
          })),
          commitmentsTruncated: obligations.nextCursor !== null,
          knowledge: memory
            .search(value.botId, { limit: 3 })
            .items.map((item) => ({ id: item.id, revision: item.revision })),
          captures: (["state", "decision", "summary"] as const).flatMap(
            (kind) =>
              memory
                .search(value.botId, {
                  kind,
                  streamId: `thread:${current.threadId}`,
                  limit: 1,
                })
                .items.map((item) => ({
                  id: item.id,
                  revision: item.revision,
                  kind,
                })),
          ),
          phase: "prepared-references-only",
          historicalObservation: observation,
        });
        store.documents.write({
          botId: value.botId,
          name: name(id),
          expectedRevision: 0,
          markdown: JSON.stringify(record),
          author: value.author,
          reason: value.reason,
        });
        return {
          id,
          checkpointId: checkpoint.checkpoint.id,
          phase: record.phase,
          replay: false,
        };
      })
      .immediate();
  }
  return {
    async show(botId: string, id: string, callerSignal?: AbortSignal) {
      const signal = callerSignal
        ? AbortSignal.any([lifecycle, callerSignal])
        : lifecycle;
      signal.throwIfAborted();
      const stored = read(botId, id);
      const [taskSource, currentCommitments] = await Promise.all([
        tasks.show(botId, signal),
        commitmentStatus.list(botId, undefined, 10, signal),
      ]);
      signal.throwIfAborted();
      let suppressedReferenceCount = 0;
      function currentReference(ref: { id: string; revision: number }) {
        const current = memory.show(botId, ref.id);
        if (current.availability === "suppressed") {
          suppressedReferenceCount++;
          return null;
        }
        return {
          id: ref.id,
          selectedRevision: ref.revision,
          currentRevision: current.revision,
          state: current.revision === ref.revision ? "unchanged" : "changed",
        };
      }
      const current = store.conversations.get(stored.record.conversationId);
      const latestSource = tasks.read(botId);
      const currentContract =
        current.role === "worker" ? work.agreement(current.id) : null;
      return {
        id,
        revision: stored.revision,
        ...stored.record,
        commitments: stored.record.commitments.map((ref) => {
          const current = currentCommitments.commitments.find(
            (item) => item.id === ref.id,
          );
          return {
            id: ref.id,
            selectedRevision: ref.revision,
            ownerConversationId: ref.ownerConversationId,
            currentRevision: current?.revision ?? null,
            currentStatus: current?.status ?? null,
            statusAvailability: current?.availability ?? "not-in-status-page",
          };
        }),
        knowledge: stored.record.knowledge.flatMap((ref) => {
          const item = currentReference(ref);
          return item ? [item] : [];
        }),
        captures: stored.record.captures.flatMap((ref) => {
          const item = currentReference(ref);
          return item ? [{ ...item, kind: ref.kind }] : [];
        }),
        suppressedReferenceCount,
        sourceMapping:
          current.threadId === stored.record.sourceThreadId
            ? "unchanged"
            : "changed",
        currentSoulRevision:
          store.documents.get(botId, "SOUL.md")?.revision ?? null,
        currentContractRevision: currentContract?.revision ?? null,
        currentContract,
        currentTaskSource:
          latestSource.revision === taskSource.revision
            ? taskSource
            : {
                ...latestSource,
                availability: "changed-during-read",
                limitation:
                  "Task authority changed during this read; inspect its current source again.",
              },
        currentCommitments: currentCommitments.commitments.map((item) => ({
          id: item.id,
          revision: item.revision,
          ownerConversationId: item.record.ownerConversationId,
          status: item.status,
          availability: item.availability,
          authority: item.authority,
        })),
        currentCommitmentsNextCursor: currentCommitments.nextCursor,
        currentReadiness: "not-evaluated-use-continuity-readiness",
        safeToExecuteTransition: false,
        limitation:
          "Prepared observations are historical, not dispatch authority or verified pickup. Resolve current records/status before use; no operation or side effect is replayed.",
      };
    },
    prepare,
    owner,
    readiness: async (
      botId: string,
      conversationId: string,
      signal?: AbortSignal,
    ) => {
      lifecycle.throwIfAborted();
      signal?.throwIfAborted();
      const conversation = owner(botId, conversationId);
      return observeNative(
        bb,
        conversation.threadId!,
        signal ? AbortSignal.any([lifecycle, signal]) : lifecycle,
      );
    },
  };
}
export type Continuity = ReturnType<typeof openContinuity>;
