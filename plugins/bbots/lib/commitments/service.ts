import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { TaskSource } from "../tasks/source.ts";
import { tasksClient } from "../tasks/client.ts";
import { addSchema, type Reference } from "./contracts.ts";
import type { CommitmentStore } from "./store.ts";

export function createCommitments(
  bb: BbPluginApi,
  store: CommitmentStore,
  source: TaskSource,
  lifecycle: AbortSignal,
) {
  const tasks = tasksClient(bb, lifecycle);
  function check(signal?: AbortSignal) {
    lifecycle.throwIfAborted();
    signal?.throwIfAborted();
  }
  function reference(
    botId: string,
    taskId?: string,
    markdownReference?: string,
  ): Reference {
    if (taskId && markdownReference)
      throw new Error("Choose one task reference.");
    if (!taskId && !markdownReference)
      return { kind: "unlinked", status: "open" };
    const current = source.read(botId).source;
    if (!current || current.phase !== "ready")
      throw new Error("Finish task-source setup before linking a commitment.");
    if (taskId && current.kind === "tasks")
      return { kind: "tasks", boardId: current.boardId, taskId };
    if (markdownReference && current.kind === "markdown")
      return {
        kind: "markdown",
        hostId: current.hostId,
        path: current.path,
        reference: markdownReference,
      };
    throw new Error(
      "The link type must match the configured task authority. No fallback or status copy is inferred.",
    );
  }
  async function view(
    found: ReturnType<CommitmentStore["get"]>,
    signal?: AbortSignal,
  ) {
    check(signal);
    const ref = found.record.reference;
    if (ref.kind === "unlinked")
      return {
        ...found,
        status: ref.status,
        availability: "local",
        authority: "commitment",
      };
    const initialSource = source.read(found.botId);
    const current = initialSource.source;
    const matches =
      current?.phase === "ready" &&
      ((ref.kind === "tasks" &&
        current.kind === "tasks" &&
        ref.boardId === current.boardId) ||
        (ref.kind === "markdown" &&
          current.kind === "markdown" &&
          ref.hostId === current.hostId &&
          ref.path === current.path));
    if (!matches)
      return {
        ...found,
        status: null,
        availability: "source-reconciliation-required",
        authority: ref.kind,
        limitation:
          "The bot's task authority changed or is not ready. Preserve this original reference and explicitly relink it from the migration mapping; no historical or copied status is substituted.",
      };
    if (ref.kind === "markdown")
      return {
        ...found,
        status: null,
        availability: "manual-source-read",
        authority: "markdown",
        limitation:
          "Read the authoritative tasks.md at this reference through the home-host path. Arbitrary Markdown has no machine-derived status; this record owns no shadow open/closed state.",
      };
    function changedDuringRead() {
      const latest = store.get(found.botId, found.id);
      if (
        latest.revision === found.revision &&
        source.read(found.botId).revision === initialSource.revision
      )
        return null;
      return {
        ...latest,
        status: null,
        availability: "changed-during-read",
        authority:
          latest.record.reference.kind === "unlinked"
            ? "commitment"
            : latest.record.reference.kind,
        limitation:
          "The commitment or task authority changed while Tasks was responding. Read it again deliberately; this response makes no status claim and starts no retry.",
      };
    }
    try {
      const task = await tasks.task(ref.taskId, signal);
      check(signal);
      const changed = changedDuringRead();
      if (changed) return changed;
      if (!task)
        return {
          ...found,
          status: null,
          availability: "missing",
          authority: "tasks",
          limitation:
            "Linked task is missing. Reconcile its reference explicitly; no replacement or local status was created.",
        };
      if (task.id !== ref.taskId || task.projectId !== ref.boardId)
        return {
          ...found,
          status: null,
          availability: "wrong-source",
          authority: "tasks",
          limitation:
            "Linked task differs from the recorded board/ID. Reconcile the reference before treating any status as authoritative.",
        };
      return {
        ...found,
        status: task.status,
        availability: "available",
        authority: "tasks",
        task: { key: task.key, title: task.title },
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      check(signal);
      const changed = changedDuringRead();
      if (changed) return changed;
      return {
        ...found,
        status: null,
        availability: "unavailable",
        authority: "tasks",
        error:
          error instanceof Error
            ? error.message.slice(0, 1024)
            : "Tasks unavailable",
        limitation:
          "The linked task remains authoritative. No cached or independent open/closed status is substituted.",
      };
    }
  }
  return {
    async show(botId: string, id: string, signal?: AbortSignal) {
      return view(store.get(botId, id), signal);
    },
    async list(
      botId: string,
      after?: string,
      limit = 20,
      signal?: AbortSignal,
    ) {
      check(signal);
      const { records, nextCursor } = store.list(botId, after, limit);
      return {
        commitments: await Promise.all(
          records.map((record) => view(record, signal)),
        ),
        nextCursor,
      };
    },
    async add(input: z.infer<typeof addSchema>, signal?: AbortSignal) {
      const value = addSchema.parse(input);
      check(signal);
      const original = store.originalReference(value.botId, value.requestId);
      if (original) {
        const matches =
          original.kind === "tasks"
            ? value.taskId === original.taskId && !value.markdownReference
            : original.kind === "markdown"
              ? value.markdownReference === original.reference && !value.taskId
              : !value.taskId && !value.markdownReference;
        if (!matches)
          throw new Error(
            "Commitment request ID already records a different submitted link. Inspect the original obligation.",
          );
      }
      const found = store.add(
        value.botId,
        {
          requestId: value.requestId,
          ownerConversationId: value.ownerConversationId,
          what: value.what,
          evidence: value.evidence,
          reference:
            original ??
            reference(value.botId, value.taskId, value.markdownReference),
        },
        value,
      );
      return view(found, signal);
    },
    async close(
      botId: string,
      id: string,
      revision: number,
      author: string,
      reason: string,
      signal?: AbortSignal,
    ) {
      check(signal);
      return view(store.close(botId, id, revision, { author, reason }), signal);
    },
    async relink(
      botId: string,
      id: string,
      revision: number,
      taskId: string | undefined,
      markdownReference: string | undefined,
      author: string,
      reason: string,
      signal?: AbortSignal,
    ) {
      check(signal);
      return view(
        store.relink(
          botId,
          id,
          revision,
          reference(botId, taskId, markdownReference),
          { author, reason },
        ),
        signal,
      );
    },
  };
}
export type Commitments = ReturnType<typeof createCommitments>;
