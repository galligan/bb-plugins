import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import type { CalibrationService } from "./calibration.ts";
import type { TriggerService } from "./triggers.ts";
import type { SourceSdk } from "./sources/contracts.ts";
import type { PublicationRef } from "./publication-storage.ts";
import type { Deadline } from "./deadline.ts";
import { canonicalJson } from "./json.ts";
import { snapshotCurrent } from "./trigger-events.ts";
type StoredDependencies = {
  repository: JudgeRepository;
  sets: SetService;
  triggers: TriggerService;
};
/** Synchronous final guard closes async validation gaps without trusting metadata. */
export function currentStoredPublication(
  { repository, sets, triggers }: StoredDependencies,
  ref: PublicationRef,
): boolean {
  if (ref.runId === null) return false;
  const run = repository.getRun(ref.runId),
    trigger = triggers.get(ref.triggerId),
    set = sets.get(ref.setId);
  if (
    !run?.complete ||
    !run.calibrated ||
    !run.set ||
    run.threadId !== ref.threadId ||
    run.projectId !== ref.snapshot.thread.projectId ||
    run.set.id !== ref.setId ||
    run.set.hash !== ref.summary.setHash ||
    set?.hash !== ref.summary.setHash ||
    !trigger?.enabled ||
    trigger.definition.setId !== ref.setId ||
    trigger.revision !== ref.summary.triggerRevision ||
    !sets.applicable(set.definition, run.projectId ?? undefined) ||
    (trigger.definition.projects !== "all" &&
      (!run.projectId || !trigger.definition.projects.includes(run.projectId)))
  )
    return false;
  if (
    run.runId !== ref.summary.runId ||
    run.startedAt !== ref.summary.timestamp ||
    canonicalJson(run.outcomes) !== canonicalJson(ref.summary.outcomes)
  )
    return false;
  const badges = Object.entries(trigger.definition.badges)
    .filter(([id]) => run.outcomes[id] === true)
    .map(([outcome, label]) => ({ outcome, label }));
  if (canonicalJson(badges) !== canonicalJson(ref.summary.badges)) return false;
  const accepted = repository.evaluations.getAcceptance(ref.setId);
  if (!accepted || accepted.setHash !== run.set.hash) return false;
  const fingerprints = Object.values(run.steps).flatMap((step) =>
    step.status === "ran" ? [step.resolvedModel.fingerprint] : [],
  );
  return (
    fingerprints.length > 0 &&
    fingerprints.every((fp) => accepted.modelFingerprints.includes(fp))
  );
}
export async function currentPublication(
  dependencies: StoredDependencies & {
    calibration: CalibrationService;
    sdk: SourceSdk;
  },
  ref: PublicationRef,
  scope: Deadline,
): Promise<boolean> {
  scope.assertActive();
  if (!currentStoredPublication(dependencies, ref)) return false;
  if (
    !(await scope.run(() =>
      dependencies.calibration.get(ref.setId, scope.signal),
    ))
  )
    return false;
  if (!(await snapshotCurrent(dependencies.sdk, ref.snapshot, scope)))
    return false;
  scope.assertActive();
  return currentStoredPublication(dependencies, ref);
}
