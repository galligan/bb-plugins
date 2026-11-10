import { currentPublication } from "./verdict-current.ts";
import { VerdictMetadataWriter } from "./verdict-writer.ts";
import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import type { ModelService } from "./models.ts";
import type { CalibrationService } from "./calibration.ts";
import type { TriggerService } from "./triggers.ts";
import type { TriggerRecord } from "./triggers-contract.ts";
import type { Verdict } from "./results.ts";
import type { PublicationRef } from "./publication-storage.ts";
import { snapshotCurrent, type TriggerSnapshot } from "./trigger-events.ts";
import type { SourceSdk } from "./sources/contracts.ts";
import { Deadline, OperationAborted } from "./deadline.ts";
import { canonicalJson } from "./json.ts";
import { boundedMetadata, summarySchema } from "./verdict-metadata.ts";

/** A display cache; the SQLite run and current configuration remain authoritative. */
export class VerdictPublisher {
  private repository: JudgeRepository;
  private sets: SetService;
  private models: ModelService;
  private calibration: CalibrationService;
  private triggers: TriggerService;
  private sdk: SourceSdk;
  private disposal = new AbortController();
  private unsubscribe: (() => void)[] = [];
  private writer: VerdictMetadataWriter;
  private cleaning = false;
  private dirty = false;
  constructor(
    repository: JudgeRepository,
    sets: SetService,
    models: ModelService,
    calibration: CalibrationService,
    triggers: TriggerService,
    sdk: SourceSdk,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.models = models;
    this.calibration = calibration;
    this.triggers = triggers;
    this.sdk = sdk;
    this.writer = new VerdictMetadataWriter(sdk, (aborted) => {
      if (aborted) this.dirty = true;
      if (this.dirty) this.reconcile();
    });
    this.unsubscribe.push(
      calibration.onChange((id) => {
        this.repository.publications.invalidateSets([id]);
        this.reconcile();
      }),
      repository.evaluations.onRetire((ids) => {
        this.repository.publications.invalidateSets(ids);
        this.reconcile();
      }),
      models.onInvalidate(() => {
        this.repository.publications.invalidateAll();
        this.reconcile();
      }),
      triggers.onChange((id) => {
        this.repository.publications.invalidateTrigger(id);
        this.reconcile();
      }),
    );
  }
  dispose(): void {
    this.disposal.abort();
    for (const off of this.unsubscribe) off();
  }
  invalidateThread(id: string): void {
    if (this.disposal.signal.aborted) return;
    this.repository.publications.invalidateThread(id);
    this.reconcile();
  }
  invalidateSet(threadId: string, setId: string): void {
    this.repository.publications.invalidateSet(threadId, setId);
    this.reconcile();
  }
  private refsCurrent(
    threadId: string,
    refs: PublicationRef[],
    generation: number,
    referenceSnapshot: string,
  ): void {
    if (this.models.configurationGeneration() !== generation)
      throw new OperationAborted("cancelled");
    const current = this.repository.publications.forThread(threadId);
    if (
      canonicalJson(current.map(({ published: _published, ...ref }) => ref)) !==
      referenceSnapshot
    )
      throw new OperationAborted("cancelled");
    for (const ref of refs) {
      const trigger = this.triggers.get(ref.triggerId);
      if (
        !trigger?.enabled ||
        trigger.revision !== ref.summary.triggerRevision ||
        this.sets.get(ref.setId)?.hash !== ref.summary.setHash
      )
        throw new OperationAborted("cancelled");
    }
    if (
      refs.some(
        (ref) =>
          !current.some(
            (row) =>
              row.setId === ref.setId &&
              row.runId === ref.runId &&
              row.summary.triggerRevision === ref.summary.triggerRevision,
          ),
      )
    )
      throw new OperationAborted("cancelled");
  }
  private async write(threadId: string, scope: Deadline): Promise<string[]> {
    scope.assertActive();
    if (this.writer.busy(threadId)) {
      this.dirty = true;
      throw new Error("metadata_busy");
    }
    const generation = this.models.configurationGeneration();
    const previousRefs = this.repository.publications.forThread(threadId);
    const referenceSnapshot = canonicalJson(
      previousRefs.map(({ published: _published, ...ref }) => ref),
    );
    const selected: PublicationRef[] = [];
    for (const ref of previousRefs)
      if (
        await currentPublication(
          {
            repository: this.repository,
            sets: this.sets,
            calibration: this.calibration,
            triggers: this.triggers,
            sdk: this.sdk,
          },
          ref,
          scope,
        )
      )
        selected.push(ref);
    const metadata = boundedMetadata(selected.map((ref) => ref.summary));
    const refs = selected.filter((ref) =>
      metadata.verdicts.summaries.some(
        (summary) => summary.runId === ref.runId,
      ),
    );
    const keys = await this.writer.keys(threadId, scope);
    for (const ref of refs)
      if (!(await snapshotCurrent(this.sdk, ref.snapshot, scope)))
        throw new OperationAborted("cancelled");
    scope.assertActive();
    this.refsCurrent(threadId, refs, generation, referenceSnapshot);
    if (this.writer.busy(threadId)) {
      this.dirty = true;
      throw new Error("metadata_busy");
    }
    const returned = await this.writer.write(threadId, metadata, keys, scope);
    if (canonicalJson(returned) !== canonicalJson(metadata))
      throw new Error("metadata_invalid");
    for (const ref of refs)
      if (!(await snapshotCurrent(this.sdk, ref.snapshot, scope)))
        throw new OperationAborted("cancelled");
    scope.assertActive();
    this.refsCurrent(threadId, refs, generation, referenceSnapshot);
    const ids = refs.map((ref) => ref.runId!);
    this.repository.publications.acknowledge(threadId, ids);
    this.repository.publications.removeUnselected(
      threadId,
      refs.map((ref) => ref.setId),
    );
    for (const ref of previousRefs)
      if (
        !ids.includes(ref.summary.runId) &&
        this.repository.triggerAttempts.get(ref.summary.runId)
      )
        this.repository.triggerAttempts.publication(
          ref.summary.runId,
          "cleared",
          null,
        );
    for (const id of ids)
      if (this.repository.triggerAttempts.get(id))
        this.repository.triggerAttempts.publication(id, "published", null);
    return ids;
  }
  async publish(
    run: Verdict,
    trigger: TriggerRecord,
    snapshot: TriggerSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!run.threadId || !run.set) return;
    const eligible =
      run.complete &&
      run.calibrated &&
      Object.keys(trigger.definition.badges).length > 0;
    if (eligible) {
      const summary = summarySchema.parse({
        runId: run.runId,
        setId: run.set.id,
        setHash: run.set.hash,
        triggerId: trigger.definition.id,
        triggerRevision: trigger.revision,
        timestamp: run.startedAt,
        outcomes: run.outcomes,
        complete: true,
        calibrated: true,
        badges: Object.entries(trigger.definition.badges)
          .filter(([id]) => run.outcomes[id] === true)
          .map(([outcome, label]) => ({ outcome, label })),
      });
      this.repository.publications.put(run.threadId, summary, snapshot);
    } else {
      if (
        !this.repository.publications
          .forThread(run.threadId)
          .some((ref) => ref.setId === run.set!.id)
      )
        return;
      this.repository.publications.invalidateSet(run.threadId, run.set.id);
    }
    const scope = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [signal, this.disposal.signal],
    });
    try {
      const published = await this.write(run.threadId, scope);
      if (eligible && !published.includes(run.runId))
        throw new OperationAborted("cancelled");
      if (!eligible)
        this.repository.triggerAttempts.publication(run.runId, "cleared", null);
    } catch (error) {
      const stale = error instanceof OperationAborted;
      this.repository.triggerAttempts.publication(
        run.runId,
        stale ? "stale" : "failed",
        stale ? "publication_stale" : "metadata_write_failed",
      );
      this.repository.publications.acknowledge(run.threadId, []);
      if (stale) {
        this.repository.publications.invalidateRun(
          run.threadId,
          run.set.id,
          run.runId,
        );
        this.dirty = true;
      }
    } finally {
      scope.close();
      if (this.dirty) this.reconcile();
    }
  }
  /** Coalesced best-effort cleanup, not an event queue or provider retry. */
  reconcile(): void {
    this.dirty = true;
    if (this.cleaning || this.disposal.signal.aborted || this.writer.busy())
      return;
    this.cleaning = true;
    queueMicrotask(() => {
      void this.clean().finally(() => {
        this.cleaning = false;
        if (this.dirty && !this.writer.hasPending()) this.reconcile();
      });
    });
  }
  private async clean(): Promise<void> {
    const scope = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [this.disposal.signal],
    });
    this.dirty = false;
    try {
      let after = "";
      for (let page = 0; page < 100; page++) {
        const threads = this.repository.publications.threads(after, 100);
        if (!threads.length) break;
        for (const threadId of threads) {
          scope.assertActive();
          if (this.writer.busy(threadId)) {
            this.dirty = true;
            continue;
          }
          const previous = this.repository.publications.forThread(threadId);
          try {
            await this.write(threadId, scope);
          } catch (error) {
            if (this.disposal.signal.aborted) return;
            if (error instanceof OperationAborted && !scope.signal.aborted) {
              this.dirty = true;
              continue;
            }
            for (const ref of previous)
              if (this.repository.triggerAttempts.get(ref.summary.runId))
                this.repository.triggerAttempts.publication(
                  ref.summary.runId,
                  "failed",
                  "metadata_clear_failed",
                );
            scope.assertActive();
          }
        }
        after = threads.at(-1)!;
      }
    } catch {
      /* Pending references remain unacknowledged; the next change can reconcile again. */
    } finally {
      scope.close();
    }
  }
}
