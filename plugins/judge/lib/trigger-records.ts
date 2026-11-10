import { randomUUID } from "node:crypto";
import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import type { TriggerRecord } from "./triggers-contract.ts";
import type { TriggerEvent } from "./trigger-events.ts";
import type { TriggerAttempt } from "./trigger-attempts.ts";
import { parseVerdict, type Verdict, type StepResult } from "./results.ts";
export type SavedSet = NonNullable<ReturnType<SetService["get"]>>;
type Failure = Extract<StepResult, { status: "unavailable" }>;
export function suppressedRun(
  repository: JudgeRepository,
  saved: SavedSet,
  event: TriggerEvent,
  failure: Failure,
  projectId?: string,
): Verdict {
  const startedAt = Date.now();
  return repository.saveRun(
    parseVerdict({
      runId: randomUUID(),
      set: { id: saved.definition.id, scope: "global", hash: saved.hash },
      threadId: event.threadId,
      projectId: projectId ?? event.thread?.projectId ?? null,
      startedAt,
      endedAt: Date.now(),
      complete: false,
      calibrated: false,
      steps: Object.fromEntries(
        saved.definition.steps.map((step, index) => [
          step.id,
          index
            ? { status: "skipped", reason: "upstream_unavailable" }
            : failure,
        ]),
      ),
      outcomes: {},
    }),
  );
}
export function recordAttempt(
  repository: JudgeRepository,
  run: Verdict,
  trigger: TriggerRecord,
  event: TriggerEvent,
  decision: TriggerAttempt["decision"],
  code: string | null = null,
): void {
  repository.triggerAttempts.save({
    runId: run.runId,
    triggerId: trigger.definition.id,
    event: event.kind,
    eventHash: event.key,
    startedAt: run.startedAt,
    decision,
    publication: "none",
    code,
  });
}
