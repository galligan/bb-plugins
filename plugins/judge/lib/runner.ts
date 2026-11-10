import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { InferenceService } from "./inference.ts";
import type { ModelService } from "./models.ts";
import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import { Deadline } from "./deadline.ts";
import { ValidationError } from "./json.ts";
import { runSchema, validateOverrides, type RunInput } from "./run-contract.ts";
import { outcomes, runStep, unavailable } from "./run-step.ts";
import { parseVerdict, type StepResult, type Verdict } from "./results.ts";
import {
  SourceFailure,
  type SourceContext,
  type SourceSdk,
} from "./sources/contracts.ts";
import type { SourceService } from "./sources/service.ts";
import { idSchema } from "./contracts.ts";

export class Runner {
  private disposal = new AbortController();
  private repository: JudgeRepository;
  private sets: SetService;
  private models: ModelService;
  private inference: Pick<InferenceService, "ask">;
  private sources: Pick<SourceService, "read">;
  private sdk: SourceSdk;
  constructor(
    repository: JudgeRepository,
    sets: SetService,
    models: ModelService,
    inference: Pick<InferenceService, "ask">,
    sources: Pick<SourceService, "read">,
    sdk: SourceSdk,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.models = models;
    this.inference = inference;
    this.sources = sources;
    this.sdk = sdk;
  }
  dispose(): void {
    this.disposal.abort();
  }

  private async context(
    input: RunInput,
    scope: Deadline,
  ): Promise<SourceContext> {
    if (!input.threadId) return { projectId: input.projectId };
    let thread;
    try {
      thread = z
        .object({
          id: idSchema,
          projectId: idSchema,
          environmentId: idSchema.nullable(),
        })
        .parse(
          await scope.run(() =>
            this.sdk.threads.get({
              threadId: input.threadId!,
              signal: scope.signal,
            }),
          ),
        );
    } catch (error) {
      scope.assertActive();
      if (error instanceof ValidationError) throw error;
      throw new SourceFailure("thread_context_unavailable");
    }
    scope.assertActive();
    if (
      thread.id !== input.threadId ||
      (input.projectId !== undefined && thread.projectId !== input.projectId)
    )
      throw new ValidationError("thread_context_mismatch");
    return {
      threadId: thread.id,
      projectId: thread.projectId,
      ...(thread.environmentId === null
        ? {}
        : { environmentId: thread.environmentId }),
    };
  }

  async run(
    value: unknown,
    signal?: AbortSignal,
    options: { deadlineAt?: number; bypassCache?: boolean } = {},
  ): Promise<Verdict> {
    const start = performance.now();
    const startedAt = Date.now();
    const input = runSchema.parse(value);
    const saved = this.sets.get(input.id);
    if (!saved) throw new ValidationError("missing_set");
    const set = saved.definition;
    validateOverrides(input, set);
    const changed = new AbortController();
    const unsubscribe = this.models.onInvalidate(() => changed.abort());
    const deadlineAt = Math.min(
      start + set.budgetMs,
      options.deadlineAt ?? Infinity,
    );
    const scope = new Deadline({
      deadlineAt,
      signals: [signal, this.disposal.signal, changed.signal],
    });
    const steps: Record<string, StepResult> = {};
    const earlier: Record<string, Record<string, boolean>> = {};
    let context: SourceContext = {
      threadId: input.threadId,
      projectId: input.projectId,
    };
    let initialFailure: StepResult | undefined;
    let stopped = false;
    try {
      try {
        context = await this.context(input, scope);
        scope.assertActive();
        if (!this.sets.applicable(set, context.projectId))
          throw new SourceFailure("set_not_applicable");
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        initialFailure = unavailable(error);
      }
      for (const step of set.steps) {
        if (stopped) {
          steps[step.id] = {
            status: "skipped",
            reason: "upstream_unavailable",
          };
          continue;
        }
        let result: StepResult;
        try {
          result =
            initialFailure ??
            (await scope.run(() =>
              runStep({
                step,
                input,
                setModel: set.model,
                context,
                scope,
                deadlineAt,
                earlier,
                sources: this.sources,
                inference: this.inference,
                bypassCache: options.bypassCache,
              }),
            ));
        } catch (error) {
          result = unavailable(error);
        }
        steps[step.id] = result;
        if (result.status === "unavailable") {
          stopped = true;
          continue;
        }
        earlier[step.id] =
          result.status === "ran"
            ? result.outcomes
            : Object.fromEntries(
                Object.keys(step.outcomes).map((id) => [id, false]),
              );
      }
      let final: Record<string, boolean> = {};
      let failure: Verdict["failure"];
      const failFinalization = (error: unknown) => {
        const { reason, code } = unavailable(error);
        failure = { reason, code };
        stopped = true;
        final = {};
      };
      if (!stopped) {
        try {
          scope.assertActive();
          final = outcomes(set.outcomes, {}, earlier);
          scope.assertActive();
        } catch (error) {
          failFinalization(error);
        }
      }
      const runId = randomUUID();
      const acceptance = stopped
        ? null
        : this.repository.evaluations.getAcceptance(set.id);
      const fingerprints = Object.values(steps).flatMap((step) =>
        step.status === "ran" ? [step.resolvedModel.fingerprint] : [],
      );
      const calibrated =
        !stopped &&
        fingerprints.length > 0 &&
        acceptance?.setHash === saved.hash &&
        fingerprints.every((fingerprint) =>
          acceptance.modelFingerprints.includes(fingerprint),
        );
      const record = () =>
        parseVerdict({
          runId,
          set: { id: set.id, scope: "global", hash: saved.hash },
          threadId: context.threadId ?? null,
          projectId: context.projectId ?? null,
          startedAt,
          endedAt: Date.now(),
          complete: !stopped,
          calibrated: !stopped && calibrated,
          ...(failure ? { failure } : {}),
          steps,
          outcomes: final,
        });
      let verdict = record();
      // Bounded verdict validation is still CPU work inside the whole-run budget.
      if (!stopped) {
        try {
          scope.assertActive();
        } catch (error) {
          failFinalization(error);
          verdict = record();
        }
      }
      return this.repository.saveRun(verdict);
    } finally {
      scope.close();
      unsubscribe();
    }
  }
}
