import type { InferenceService } from "./inference.ts";
import { Deadline, OperationAborted } from "./deadline.ts";
import { evaluateExpression, type Expression } from "./outcomes.ts";
import { ValidationError, type Json } from "./json.ts";
import type { StepDefinition } from "./sets-schema.ts";
import type { Provenance, StepResult } from "./results.ts";
import type { SourceService } from "./sources/service.ts";
import {
  SourceFailure,
  sourceValue,
  type SourceContext,
} from "./sources/contracts.ts";
import type { RunInput } from "./run-contract.ts";

export function outcomes(
  expressions: Record<string, Expression>,
  answers: Parameters<typeof evaluateExpression>[1],
  earlier: Record<string, Record<string, boolean>>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(expressions).map(([id, expression]) => [
      id,
      evaluateExpression(expression, answers, earlier),
    ]),
  );
}
export function unavailable(
  error: unknown,
): Extract<StepResult, { status: "unavailable" }> {
  if (error instanceof OperationAborted)
    return { status: "unavailable", reason: error.reason, code: error.reason };
  if (error instanceof SourceFailure)
    return { status: "unavailable", reason: error.reason, code: error.code };
  if (
    error instanceof ValidationError &&
    ["too_large", "too_deep"].includes(error.message)
  )
    return {
      status: "unavailable",
      reason: "too_large",
      code: "request_bounds",
    };
  return { status: "unavailable", reason: "error", code: "step_failed" };
}

/** Local step state is never shared with later steps or retained in a verdict. */
export async function runStep(options: {
  step: StepDefinition;
  input: RunInput;
  setModel?: string;
  context: SourceContext;
  scope: Deadline;
  deadlineAt: number;
  bypassCache?: boolean;
  earlier: Record<string, Record<string, boolean>>;
  sources: Pick<SourceService, "read">;
  inference: Pick<InferenceService, "ask">;
}): Promise<StepResult> {
  const { step, input, scope, earlier } = options;
  scope.assertActive();
  if (step.when !== undefined && !evaluateExpression(step.when, {}, earlier))
    return { status: "skipped", reason: "gate_false" };
  const state: Record<string, Json> = {};
  const provenance: Record<string, Provenance> = {};
  let sensitive = false;
  for (const [name, definition] of Object.entries(step.inputs)) {
    scope.assertActive();
    const overrides = input.inputs?.[step.id];
    const result =
      overrides && Object.hasOwn(overrides, name)
        ? sourceValue(overrides[name]!, definition, true, {
            source: "caller_override",
          })
        : await options.sources.read(definition, {
            ...options.context,
            signal: scope.signal,
            deadlineAt: options.deadlineAt,
          });
    scope.assertActive();
    if (result.status !== "ok")
      return {
        status: "unavailable",
        reason: result.reason,
        code: result.code,
      };
    state[name] = result.value;
    provenance[name] = result.provenance;
    sensitive ||= result.sensitive;
  }
  scope.assertActive();
  const outcome = await options.inference.ask({
    state,
    questions: step.questions,
    selection: {
      override: input.model,
      step: step.model,
      set: options.setModel,
      sensitive,
    },
    signal: scope.signal,
    deadlineAt: options.deadlineAt,
    bypassCache: options.bypassCache,
  });
  scope.assertActive();
  const result = outcome.result;
  if (result.status !== "ran")
    return { status: "unavailable", reason: result.reason, code: result.code };
  const evaluated = outcomes(step.outcomes, result.answers, earlier);
  scope.assertActive();
  return {
    status: "ran",
    requestedModel: outcome.requestedModel!,
    resolvedModel: outcome.resolvedModel!,
    providerModel: result.providerModel,
    fallbackReason: outcome.fallbackReason ?? null,
    answers: result.answers,
    outcomes: evaluated,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    cacheHit: outcome.cacheHit ?? false,
    provenance,
  };
}
