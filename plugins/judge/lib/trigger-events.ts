import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { hashJson, canonicalJson } from "./json.ts";
import type { Deadline } from "./deadline.ts";
import {
  SourceFailure,
  normalizedEventSchema,
  type SourceContext,
  type SourceSdk,
} from "./sources/contracts.ts";

const threadSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  updatedAt: z.number().int().nonnegative().safe(),
  status: z.enum([
    "idle",
    "error",
    "active",
    "pending",
    "starting",
    "stopping",
  ]),
  archivedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
});
type ThreadSnapshot = z.infer<typeof threadSchema>;
export type TriggerEvent = {
  kind: "thread.idle" | "turn.failed";
  threadId: string;
  key: string;
  idle?: { lastAssistantText: string | null };
  thread?: ThreadSnapshot;
  failure?: {
    requestId: string;
    turnId: string | null;
    attemptNumber: number;
    inputAccepted: boolean;
    error: string | null;
  };
};
export function idleEvent(value: unknown): TriggerEvent {
  const payload = z
    .object({ thread: threadSchema, lastAssistantText: z.string().nullable() })
    .parse(value);
  if (payload.thread.status !== "idle")
    throw new SourceFailure("event_state_mismatch");
  return {
    kind: "thread.idle",
    threadId: payload.thread.id,
    key: hashJson({
      kind: "thread.idle",
      threadId: payload.thread.id,
      updatedAt: payload.thread.updatedAt,
    }),
    thread: payload.thread,
    idle: { lastAssistantText: payload.lastAssistantText },
  };
}
export function failedEvent(value: unknown): TriggerEvent {
  const payload = z
    .object({
      threadId: idSchema,
      requestId: idSchema,
      turnId: idSchema.nullable(),
      attemptNumber: z.number().int().positive().safe(),
      inputAccepted: z.boolean(),
      errorInfo: z.object({ message: z.string().optional() }).nullable(),
    })
    .parse(value);
  const failure = {
    requestId: payload.requestId,
    turnId: payload.turnId,
    attemptNumber: payload.attemptNumber,
    inputAccepted: payload.inputAccepted,
    error: payload.errorInfo?.message ?? null,
  };
  return {
    kind: "turn.failed",
    threadId: payload.threadId,
    key: hashJson({
      kind: "turn.failed",
      threadId: payload.threadId,
      requestId: payload.requestId,
      turnId: payload.turnId,
      attemptNumber: payload.attemptNumber,
    }),
    failure,
  };
}
const eventRowSchema = z.object({
  threadId: idSchema,
  seq: z.number().int().nonnegative().safe(),
  type: z.string(),
  data: z.unknown(),
});
async function latest(
  sdk: SourceSdk,
  threadId: string,
  scope: Deadline,
  requestOnly = false,
) {
  const rows = z
    .array(eventRowSchema)
    .max(1)
    .parse(
      await scope.run(() =>
        sdk.threads.events.list({
          threadId,
          order: "desc",
          limit: "1",
          ...(requestOnly ? { types: ["client/turn/requested" as const] } : {}),
          signal: scope.signal,
        }),
      ),
    );
  if (
    rows.some(
      (row) =>
        row.threadId !== threadId ||
        (requestOnly && row.type !== "client/turn/requested"),
    )
  )
    throw new SourceFailure("event_context_mismatch");
  return rows[0] ?? null;
}
export const triggerSnapshotSchema = z.strictObject({
  thread: threadSchema,
  sequence: z.number().int().nonnegative().safe().nullable(),
  requestId: idSchema.nullable(),
});
export type TriggerSnapshot = z.infer<typeof triggerSnapshotSchema>;
export async function snapshot(
  sdk: SourceSdk,
  event: TriggerEvent,
  scope: Deadline,
): Promise<{ snapshot: TriggerSnapshot; context: SourceContext }> {
  const thread = threadSchema.parse(
    await scope.run(() =>
      sdk.threads.get({ threadId: event.threadId, signal: scope.signal }),
    ),
  );
  if (
    thread.id !== event.threadId ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.status !== (event.kind === "thread.idle" ? "idle" : "error")
  )
    throw new SourceFailure("event_superseded");
  if (event.thread && canonicalJson(event.thread) !== canonicalJson(thread))
    throw new SourceFailure("event_superseded");
  const row = await latest(sdk, event.threadId, scope);
  let requestId: string | null = null;
  if (event.failure) {
    const requested = await latest(sdk, event.threadId, scope, true);
    requestId = requested
      ? z.object({ requestId: idSchema }).parse(requested.data).requestId
      : null;
    if (requestId !== event.failure.requestId)
      throw new SourceFailure("event_request_superseded");
  }
  scope.assertActive();
  const normalized = normalizedEventSchema.parse({
    kind: event.kind,
    threadId: thread.id,
    projectId: thread.projectId,
    ...event.failure,
  });
  return {
    snapshot: { thread, sequence: row?.seq ?? null, requestId },
    context: {
      threadId: thread.id,
      projectId: thread.projectId,
      ...(thread.environmentId === null
        ? {}
        : { environmentId: thread.environmentId }),
      ...(event.idle ? { idle: event.idle } : {}),
      event: normalized,
    },
  };
}
export async function stillFresh(
  sdk: SourceSdk,
  event: TriggerEvent,
  before: TriggerSnapshot,
  scope: Deadline,
): Promise<boolean> {
  const after = await snapshot(sdk, event, scope);
  return canonicalJson(after.snapshot) === canonicalJson(before);
}

/** A stored publication contains only this identifier/status/sequence stamp, never source text. */
export async function snapshotCurrent(
  sdk: SourceSdk,
  before: TriggerSnapshot,
  scope: Deadline,
): Promise<boolean> {
  const thread = threadSchema.parse(
    await scope.run(() =>
      sdk.threads.get({ threadId: before.thread.id, signal: scope.signal }),
    ),
  );
  if (canonicalJson(thread) !== canonicalJson(before.thread)) return false;
  const row = await latest(sdk, thread.id, scope);
  if ((row?.seq ?? null) !== before.sequence) return false;
  if (before.requestId !== null) {
    const request = await latest(sdk, thread.id, scope, true);
    if (
      !request ||
      z.object({ requestId: idSchema }).parse(request.data).requestId !==
        before.requestId
    )
      return false;
  }
  scope.assertActive();
  return true;
}
