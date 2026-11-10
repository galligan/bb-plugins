import { randomUUID } from "node:crypto";
import type { Runner } from "./runner.ts";
import type { SetService } from "./sets.ts";
import type { ModelService, ModelIdentity } from "./models.ts";
import type { JudgeRepository } from "./storage.ts";
import { Deadline } from "./deadline.ts";
import { ValidationError, LIMITS } from "./json.ts";
import { unavailable } from "./run-step.ts";
import type { Verdict } from "./results.ts";
import { compare, summarize } from "./evaluation-summary.ts";
import {
  EVALUATION_BUDGET_MS,
  MODEL_LABEL_LIMITATION,
  evaluationInputSchema,
  parseEvaluationReport,
  type CaseEvaluation,
  type EvaluationCase,
  type EvaluationReport,
  type VariantEvaluation,
} from "./evaluation-contract.ts";

type Failure = NonNullable<EvaluationReport["failure"]>;
function pending(index: number, failure: Failure): CaseEvaluation {
  return {
    index,
    runId: null,
    status: "unavailable",
    outcomes: {},
    failure,
    steps: { ran: 0, skipped: 0, unavailable: 0 },
    durationMs: 0,
  };
}
function resultFor(
  index: number,
  expected: Record<string, boolean>,
  verdict: Verdict,
): CaseEvaluation {
  const steps = { ran: 0, skipped: 0, unavailable: 0 };
  for (const step of Object.values(verdict.steps)) steps[step.status]++;
  const failed = Object.values(verdict.steps).find(
    (step) => step.status === "unavailable",
  );
  const failure = verdict.complete
    ? null
    : (verdict.failure ??
      (failed?.status === "unavailable"
        ? { reason: failed.reason, code: failed.code }
        : { reason: "error" as const, code: "case_incomplete" }));
  return {
    index,
    runId: verdict.runId,
    status: !verdict.complete
      ? "unavailable"
      : Object.entries(expected).every(
            ([id, value]) => verdict.outcomes[id] === value,
          )
        ? "correct"
        : "incorrect",
    outcomes: verdict.complete ? verdict.outcomes : {},
    failure,
    steps,
    durationMs: verdict.endedAt - verdict.startedAt,
  };
}

/** Explicit authored cases only; no live source read, automatic acceptance or winner. */
export class EvaluationService {
  private repository: JudgeRepository;
  private sets: SetService;
  private models: ModelService;
  private runner: Runner;
  private disposal = new AbortController();
  private busy = false;
  constructor(
    repository: JudgeRepository,
    sets: SetService,
    models: ModelService,
    runner: Runner,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.models = models;
    this.runner = runner;
  }
  dispose(): void {
    this.disposal.abort();
  }
  async test(value: unknown, signal?: AbortSignal): Promise<EvaluationReport> {
    const start = performance.now();
    const startedAt = Date.now();
    const input = evaluationInputSchema.parse(value);
    const saved = this.sets.get(input.id);
    if (!saved) throw new ValidationError("missing_set");
    const definition = saved.definition;
    if (!definition.cases.length) throw new ValidationError("cases_required");
    const overrides =
      input.compare === undefined
        ? [input.model]
        : [input.model, input.compare];
    // Reserve report overhead before spending on a definition that cannot fit its report.
    const expectedBytes = Buffer.byteLength(
      JSON.stringify(definition.cases.map((c) => c.expect)),
    );
    if (
      expectedBytes * (overrides.length + 2) + 128 * 1024 >
      LIMITS.responseBytes
    )
      throw new ValidationError("evaluation_report_size");
    if (this.busy) throw new ValidationError("evaluation_busy");
    const generation = this.models.configurationGeneration();
    const changed = new AbortController();
    const unsubscribe = this.models.onInvalidate(() => changed.abort());
    const deadlineAt = start + EVALUATION_BUDGET_MS;
    const scope = new Deadline({
      deadlineAt,
      signals: [signal, this.disposal.signal, changed.signal],
    });
    const cases: EvaluationCase[] = definition.cases.map((c, index) => ({
      index,
      id: c.id ?? null,
      expect: c.expect,
    }));
    const variants: VariantEvaluation[] = [];
    let failure: Failure | null = null;
    let stale = false;
    this.busy = true;
    const failed = (error: unknown) => {
      const result = unavailable(error);
      failure = {
        reason: result.reason,
        code: changed.signal.aborted ? "configuration_changed" : result.code,
      };
      stale ||= changed.signal.aborted;
    };
    try {
      for (const [variantIndex, model] of overrides.entries()) {
        const results: CaseEvaluation[] = [];
        const identities: ModelIdentity[] = [];
        const requestedModels: string[] = [];
        for (const [index, authored] of definition.cases.entries()) {
          if (failure === null) {
            try {
              scope.assertActive();
            } catch (error) {
              failed(error);
            }
          }
          if (failure !== null) {
            results.push(pending(index, failure));
            continue;
          }
          // Runner owns bounded reads/requests and finishes its cancellation record before returning.
          const verdict = await this.runner.run(
            {
              id: input.id,
              inputs: authored.inputs,
              ...(input.projectId === undefined
                ? {}
                : { projectId: input.projectId }),
              ...(model === undefined ? {} : { model }),
            },
            scope.signal,
            { deadlineAt, bypassCache: true },
          );
          results.push(resultFor(index, authored.expect, verdict));
          for (const step of Object.values(verdict.steps))
            if (step.status === "ran") {
              if (
                !identities.some(
                  (i) =>
                    i.id === step.resolvedModel.id &&
                    i.fingerprint === step.resolvedModel.fingerprint,
                )
              )
                identities.push(step.resolvedModel);
              if (!requestedModels.includes(step.requestedModel))
                requestedModels.push(step.requestedModel);
            }
          try {
            scope.assertActive();
          } catch (error) {
            failed(error);
          }
        }
        variants.push({
          kind: variantIndex ? "comparison" : "primary",
          modelOverride: model ?? null,
          identities,
          requestedModels,
          results,
          ...summarize(cases, results),
        });
      }
      if (failure === null) {
        try {
          scope.assertActive();
          for (const identity of variants.flatMap((v) => v.identities)) {
            if (!(await scope.run(() => this.models.isCurrent(identity)))) {
              stale = true;
              failure = { reason: "cancelled", code: "configuration_changed" };
              break;
            }
          }
          const current = this.sets.get(input.id);
          if (
            current?.hash !== saved.hash ||
            this.models.configurationGeneration() !== generation
          ) {
            stale = true;
            failure = { reason: "cancelled", code: "configuration_changed" };
          }
          scope.assertActive();
        } catch (error) {
          failed(error);
        }
      }
      const id = randomUUID();
      const assemble = () =>
        parseEvaluationReport({
          id,
          set: { id: input.id, scope: "global", hash: saved.hash },
          projectId: input.projectId ?? null,
          startedAt,
          endedAt: Date.now(),
          elapsedMs: Math.max(0, performance.now() - start),
          budgetMs: EVALUATION_BUDGET_MS,
          configurationGeneration: generation,
          stepsPerCase: definition.steps.length,
          plannedRequestsUpperBound:
            definition.steps.length * cases.length * variants.length,
          cases,
          variants,
          disagreements: compare(variants),
          complete:
            failure === null &&
            !stale &&
            variants.every((v) => v.counts.unavailable === 0),
          stale,
          failure,
          modelLabelLimitation: MODEL_LABEL_LIMITATION,
        });
      let report = assemble();
      if (failure === null) {
        try {
          scope.assertActive();
        } catch (error) {
          failed(error);
          report = assemble();
        }
      }
      return this.repository.evaluations.saveReport(report);
    } finally {
      this.busy = false;
      unsubscribe();
      scope.close();
    }
  }
}
