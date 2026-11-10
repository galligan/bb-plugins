import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import type { ModelService } from "./models.ts";
import type { TriggerService } from "./triggers.ts";
import type { TriggerRecord } from "./triggers-contract.ts";
import type { Runner } from "./runner.ts";
import type { VerdictPublisher } from "./verdict-publisher.ts";
import { SourceFailure, type SourceSdk } from "./sources/contracts.ts";
import { Deadline, OperationAborted } from "./deadline.ts";
import {
  idleEvent,
  failedEvent,
  snapshot,
  stillFresh,
  type TriggerEvent,
} from "./trigger-events.ts";
import type { Verdict } from "./results.ts";
import {
  suppressedRun,
  recordAttempt,
  type SavedSet as Saved,
} from "./trigger-records.ts";
import { unavailable } from "./run-step.ts";

/** Best-effort event admission: two runs globally, one per thread, no queue. */
export class TriggerEngine {
  private repository: JudgeRepository;
  private sets: SetService;
  private triggers: TriggerService;
  private runner: Runner;
  private publisher: VerdictPublisher;
  private sdk: SourceSdk;
  private disposal = new AbortController();
  private active = new Map<
    string,
    {
      triggerId: string;
      controller: AbortController;
      sequence?: number;
      observedSequence?: number;
    }
  >();
  private seen = new Map<string, number>();
  private jobs = new Set<Promise<void>>();
  private unsubscribe: (() => void)[] = [];
  constructor(
    repository: JudgeRepository,
    sets: SetService,
    models: ModelService,
    triggers: TriggerService,
    runner: Runner,
    publisher: VerdictPublisher,
    sdk: SourceSdk,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.triggers = triggers;
    this.runner = runner;
    this.publisher = publisher;
    this.sdk = sdk;
    this.unsubscribe.push(
      models.onInvalidate(() => {
        for (const run of this.active.values()) run.controller.abort();
      }),
      triggers.onChange((id) => {
        for (const run of this.active.values())
          if (run.triggerId === id) run.controller.abort();
      }),
    );
  }
  async dispose(): Promise<void> {
    this.disposal.abort();
    for (const run of this.active.values()) run.controller.abort();
    for (const off of this.unsubscribe) off();
    this.seen.clear();
    // The host awaits this hook before closing SQLite; finish cancellation records first.
    await Promise.allSettled(this.jobs);
  }
  advance(threadId: string): void {
    if (this.disposal.signal.aborted) return;
    this.active.get(threadId)?.controller.abort();
    this.publisher.invalidateThread(threadId);
  }
  observe(threadId: string, sequence: number): void {
    if (
      this.disposal.signal.aborted ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    )
      return;
    const active = this.active.get(threadId);
    if (active) {
      active.observedSequence = Math.max(
        active.observedSequence ?? -1,
        sequence,
      );
      if (active.sequence !== undefined && sequence > active.sequence)
        this.advance(threadId);
    } else if (
      this.repository.publications
        .forThread(threadId)
        .some((ref) => sequence > (ref.snapshot.sequence ?? -1))
    )
      this.publisher.invalidateThread(threadId);
  }
  idle(value: unknown): Promise<void> {
    return this.handle(idleEvent(value));
  }
  failed(value: unknown): Promise<void> {
    return this.handle(failedEvent(value));
  }
  private duplicate(key: string): boolean {
    const now = Date.now();
    for (const [id, time] of this.seen)
      if (time > now || now - time >= 300000) this.seen.delete(id);
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    while (this.seen.size > 1000)
      this.seen.delete(this.seen.keys().next().value!);
    return false;
  }
  private applicable(
    saved: Saved,
    trigger: TriggerRecord,
    projectId: string,
  ): boolean {
    return (
      this.sets.applicable(saved.definition, projectId) &&
      (trigger.definition.projects === "all" ||
        trigger.definition.projects.includes(projectId))
    );
  }
  private async handle(event: TriggerEvent): Promise<void> {
    if (this.disposal.signal.aborted) return;
    const bindings = this.repository.triggers.enabled(event.kind);
    if (!bindings.length) return;
    const duplicate = this.duplicate(event.key);
    if (!duplicate) this.advance(event.threadId);
    const pending: Promise<void>[] = [];
    for (const trigger of bindings) {
      const saved = this.sets.get(trigger.definition.setId);
      if (!saved) throw new Error("trigger_set_missing");
      const decision = duplicate
        ? "duplicate"
        : event.thread &&
            !this.applicable(saved, trigger, event.thread.projectId)
          ? "not_applicable"
          : this.active.size >= 2 || this.active.has(event.threadId)
            ? "busy"
            : null;
      if (decision) {
        const code =
          decision === "duplicate"
            ? "duplicate_event"
            : decision === "busy"
              ? "trigger_busy"
              : "set_not_applicable";
        const run = suppressedRun(this.repository, saved, event, {
          status: "unavailable",
          reason:
            decision === "not_applicable" ? "source_unavailable" : "cancelled",
          code,
        });
        recordAttempt(this.repository, run, trigger, event, decision, code);
        continue;
      }
      const controller = new AbortController();
      this.active.set(event.threadId, {
        triggerId: trigger.definition.id,
        controller,
      });
      const job = this.execute(saved, trigger, event, controller).finally(
        () => {
          if (this.active.get(event.threadId)?.controller === controller)
            this.active.delete(event.threadId);
          this.jobs.delete(job);
        },
      );
      this.jobs.add(job);
      pending.push(job);
    }
    await Promise.all(pending);
  }
  private async execute(
    saved: Saved,
    trigger: TriggerRecord,
    event: TriggerEvent,
    controller: AbortController,
  ): Promise<void> {
    const deadlineAt = performance.now() + saved.definition.budgetMs;
    const scope = new Deadline({
      deadlineAt,
      signals: [controller.signal, this.disposal.signal],
    });
    let run: Verdict;
    let observed: Awaited<ReturnType<typeof snapshot>> | undefined;
    try {
      observed = await snapshot(this.sdk, event, scope);
      const active = this.active.get(event.threadId);
      if (active?.controller === controller) {
        active.sequence = observed.snapshot.sequence ?? -1;
        if ((active.observedSequence ?? -1) > active.sequence)
          controller.abort();
      }
      scope.assertActive();
      if (!this.applicable(saved, trigger, observed.context.projectId!)) {
        run = suppressedRun(
          this.repository,
          saved,
          event,
          {
            status: "unavailable",
            reason: "source_unavailable",
            code: "set_not_applicable",
          },
          observed.context.projectId,
        );
        recordAttempt(
          this.repository,
          run,
          trigger,
          event,
          "not_applicable",
          "set_not_applicable",
        );
        return;
      }
      run = await this.runner.run(
        {
          id: saved.definition.id,
          threadId: event.threadId,
          projectId: observed.context.projectId,
        },
        scope.signal,
        {
          deadlineAt,
          sourceContext: {
            idle: observed.context.idle,
            event: observed.context.event,
          },
        },
      );
    } catch (error) {
      const failure =
        controller.signal.aborted || this.disposal.signal.aborted
          ? {
              status: "unavailable" as const,
              reason: "cancelled" as const,
              code: "configuration_or_event_changed",
            }
          : unavailable(error);
      run = suppressedRun(
        this.repository,
        saved,
        event,
        failure,
        observed?.context.projectId,
      );
      recordAttempt(
        this.repository,
        run,
        trigger,
        event,
        "unavailable",
        failure.code,
      );
      this.publisher.invalidateSet(event.threadId, saved.definition.id);
      return;
    } finally {
      scope.close();
    }
    recordAttempt(this.repository, run, trigger, event, "ran");
    const publication = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [controller.signal, this.disposal.signal],
    });
    try {
      const current = this.triggers.get(trigger.definition.id);
      if (
        !current?.enabled ||
        current.revision !== trigger.revision ||
        this.sets.get(saved.definition.id)?.hash !== saved.hash
      )
        throw new OperationAborted("cancelled");
      if (!(await stillFresh(this.sdk, event, observed!.snapshot, publication)))
        throw new OperationAborted("cancelled");
      publication.assertActive();
      await this.publisher.publish(
        run,
        trigger,
        observed!.snapshot,
        publication.signal,
      );
    } catch (error) {
      const stale =
        error instanceof OperationAborted ||
        error instanceof SourceFailure ||
        controller.signal.aborted ||
        this.disposal.signal.aborted;
      this.repository.triggerAttempts.publication(
        run.runId,
        stale ? "stale" : "failed",
        stale ? "publication_stale" : "publication_failed",
      );
      this.publisher.invalidateSet(event.threadId, saved.definition.id);
    } finally {
      publication.close();
    }
  }
}
