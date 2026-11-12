import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { observationSchema } from "./contracts.ts";

type Native = BbPluginApi["sdk"]["threads"];
type Context = Awaited<ReturnType<Native["context"]>>;
type Thread = Awaited<ReturnType<Native["get"]>>;
type Events = Awaited<ReturnType<Native["events"]["list"]>>;
type Queue = Awaited<ReturnType<Native["queuedMessages"]["list"]>>;

export function summarizeNative(
  thread: Thread,
  context: Context,
  events: Events,
  queue: Queue,
  now: number,
) {
  events = [...events].sort((a, b) => b.seq - a.seq);
  const snapshot = context.usage?.snapshot;
  const contextChange = events.find(
    (event) =>
      event.type === "thread/compacted" ||
      event.type === "thread/context/cleared",
  );
  const latestUsage = events.find(
    (event) => event.type === "thread/contextWindowUsage/updated",
  );
  const capturedAt = snapshot ? Date.parse(snapshot.capturedAt) : NaN;
  const ageMs = now - capturedAt;
  const valid =
    snapshot &&
    Number.isFinite(ageMs) &&
    Number.isFinite(snapshot.usedTokens) &&
    snapshot.usedTokens >= 0 &&
    Number.isFinite(snapshot.contextWindowTokens) &&
    snapshot.contextWindowTokens > 0 &&
    snapshot.providerSessionId.length > 0;
  const usage = valid
    ? {
        status:
          ageMs < 0 ||
          ageMs > 60_000 ||
          (contextChange && contextChange.createdAt > capturedAt) ||
          (latestUsage?.type === "thread/contextWindowUsage/updated" &&
            latestUsage.data.contextWindowUsage.snapshot &&
            latestUsage.data.contextWindowUsage.snapshot.providerSessionId !==
              snapshot.providerSessionId)
            ? ("stale" as const)
            : snapshot.estimated || context.usage?.estimated
              ? ("estimated" as const)
              : ("fresh" as const),
        capturedAt: snapshot.capturedAt,
        usedTokens: snapshot.usedTokens,
        contextWindowTokens: snapshot.contextWindowTokens,
        providerSessionId: snapshot.providerSessionId,
        providerTurnId: snapshot.providerTurnId,
        model: snapshot.model,
      }
    : { status: "unavailable" as const };
  const interruptions = events.filter(
    (event) => event.type === "system/thread/interrupted",
  );
  const stop = interruptions.find(
    (event) =>
      event.type === "system/thread/interrupted" &&
      event.data.reason === "manual-stop",
  );
  return observationSchema.parse({
    observedAt: new Date(now).toISOString(),
    threadId: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    providerId: thread.providerId,
    parentThreadId: thread.parentThreadId,
    parentNotifications: thread.parentNotifications,
    pinnedAt: thread.pinnedAt,
    activeBackgroundAgentCount: thread.activeBackgroundAgentCount,
    status: thread.status,
    runtimeStatus: thread.runtime.displayStatus,
    threadUpdatedAt: thread.updatedAt,
    usage,
    queue: {
      count: queue.length,
      ids: queue.slice(0, 20).map((item) => item.id),
      complete:
        queue.length <= 20 && queue.length === thread.queuedMessageCount,
    },
    events: {
      latestSeq: events[0]?.seq ?? null,
      windowFull: events.length >= 20,
      manualStop: stop ? { seq: stop.seq, createdAt: stop.createdAt } : null,
      stopEvidence: stop
        ? ("manual-stop-observed" as const)
        : ("not-established" as const),
      latestContextChange: contextChange
        ? {
            type: contextChange.type,
            seq: contextChange.seq,
            createdAt: contextChange.createdAt,
          }
        : null,
    },
    automaticTransitions: "disabled" as const,
    safeToExecuteTransition: false as const,
    limitations: [
      "Point-in-time observations do not establish process settlement, dispatch permission, current provider-session identity or future queue preservation.",
      "Fresh means a nonestimated snapshot at most60s old; missing timestamps, estimates and future/stale timestamps are not fresh measurements.",
      "No manual-stop event in this bounded window does not establish consent. Idle is not dispatch authority.",
    ],
  });
}

export async function observeNative(
  bb: BbPluginApi,
  threadId: string,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const [thread, context, events, queue] = await Promise.all([
    bb.sdk.threads.get({ threadId, signal: bounded }),
    bb.sdk.threads.context({ threadId, signal: bounded }),
    bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      limit: "20",
      signal: bounded,
      types: [
        "system/thread/interrupted",
        "thread/compacted",
        "thread/context/cleared",
        "client/turn/requested",
        "turn/completed",
        "thread/contextWindowUsage/updated",
      ],
    }),
    bb.sdk.threads.queuedMessages.list({ threadId, signal: bounded }),
  ]);
  bounded.throwIfAborted();
  if (
    thread.id !== threadId ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null
  )
    throw new Error(
      "Current owned source is unavailable, archived or removed; no continuation was prepared.",
    );
  if (events.some((event) => event.threadId !== threadId))
    throw new Error("Native event source differs from the owned conversation.");
  return summarizeNative(thread, context, events, queue, Date.now());
}
