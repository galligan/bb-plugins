import type { JudgeApi } from "./api.ts";
import {
  displayRowsSchema,
  threadDisplaySchema,
  type DisplayRow,
} from "./ui-contract.ts";
import { verdictKeysSchema } from "./verdict-reader.ts";
function row(
  value: Awaited<ReturnType<JudgeApi["verdicts"]["keyed"]>>["threads"][number],
): DisplayRow {
  const badges = value.summaries.flatMap((summary) =>
    summary.badges.map((badge) => ({
      setId: summary.setId,
      label: badge.label,
    })),
  );
  return {
    threadId: value.threadId,
    badges: badges.slice(0, 20),
    extraBadges: Math.max(0, badges.length - 20),
    publicationFailure: value.publicationFailure,
  };
}
export async function displayBadges(
  api: JudgeApi,
  value: unknown,
  signal?: AbortSignal,
) {
  const input = verdictKeysSchema.parse(value);
  return displayRowsSchema.parse({
    threads: (await api.verdicts.keyed(input, signal)).threads.map(row),
  });
}
export async function displayThread(
  api: JudgeApi,
  threadId: string,
  signal?: AbortSignal,
) {
  const current = await api.verdicts.keyed({ threadIds: [threadId] }, signal);
  const summary = api.log({ threadId, limit: 1 }).runs[0];
  const run = summary ? api.repository.getRun(summary.runId) : null;
  const latest = run
    ? {
        runId: run.runId,
        setId: run.set?.id ?? null,
        startedAt: run.startedAt,
        status: !run.complete
          ? Object.values(run.steps).some((s) => s.status === "unavailable") ||
            run.failure
            ? "unavailable"
            : "incomplete"
          : !run.calibrated
            ? "uncalibrated"
            : current.threads[0]!.summaries.some((s) => s.runId === run.runId)
              ? "current"
              : "recorded",
        code:
          run.failure?.code ??
          Object.values(run.steps).find((s) => s.status === "unavailable")
            ?.code ??
          null,
        models: Object.values(run.steps).flatMap((s) =>
          s.status === "ran"
            ? [
                {
                  id: s.resolvedModel.id,
                  model: s.resolvedModel.model,
                  providerModel: s.providerModel ?? null,
                },
              ]
            : [],
        ),
      }
    : null;
  return threadDisplaySchema.parse({
    current: row(current.threads[0]!),
    latest,
  });
}
/** Notifications carry configuration changes or bounded IDs, never run data. */
export function registerUiUpdates(
  bb: import("@get-bb/plugin-sdk").BbPluginApi,
  api: JudgeApi,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let configuration = false;
  let allThreads = false;
  const threadIds = new Set<string>();
  const changed = (threadId?: string) => {
    if (disposed) return;
    if (threadId === undefined) configuration = true;
    else if (!allThreads) {
      threadIds.add(threadId);
      if (threadIds.size > 200) {
        allThreads = true;
        threadIds.clear();
      }
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      bb.realtime.publish("changed", {
        configuration,
        threadIds: allThreads ? null : [...threadIds],
      });
      configuration = false;
      allThreads = false;
      threadIds.clear();
    }, 50);
  };
  const config = () => changed();
  const off = [
    api.models.onInvalidate(config),
    api.triggers.onChange(config),
    api.calibration.onChange(config),
    api.repository.evaluations.onRetire(config),
    api.repository.onRun((id) => {
      if (id) changed(id);
    }),
    api.publisher.onChange(changed),
  ];
  bb.onDispose(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
    for (const unsubscribe of off) unsubscribe();
  });
  for (const event of [
    "thread.active",
    "thread.archived",
    "thread.deleted",
    "thread.failed",
    "thread.idle",
    "experimental_thread.events",
  ] as const)
    bb.events.on(event, ({ thread }) => changed(thread.id));
  bb.events.on("turn.failed", ({ threadId }) => changed(threadId));
}
