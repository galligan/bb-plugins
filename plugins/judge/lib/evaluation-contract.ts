import { z } from "zod";
import { idSchema, strictRecord } from "./contracts.ts";
import {
  hashSchema,
  modelIdentitySchema,
  unavailableReasonSchema,
} from "./results.ts";
import {
  assertJson,
  assertLossless,
  canonicalJson,
  LIMITS,
  type Json,
} from "./json.ts";
import { compare, summarize } from "./evaluation-summary.ts";

export const EVALUATION_BUDGET_MS = 30_000;
export const MODEL_LABEL_LIMITATION =
  "Model selectors and returned provider labels do not prove immutable weights. Repeat evaluation when provider changes are known.";
const booleans = strictRecord(idSchema, z.boolean()).refine(
  (v) => Object.keys(v).length <= 64,
);
const failure = z.strictObject({
  reason: unavailableReasonSchema,
  code: idSchema,
});
const counts = z.strictObject({
  ran: z.number().int().min(0).max(1600),
  skipped: z.number().int().min(0).max(1600),
  unavailable: z.number().int().min(0).max(1600),
});
const caseSchema = z.strictObject({
  index: z.number().int().min(0).max(99),
  id: idSchema.nullable(),
  expect: booleans,
});
const resultSchema = z.strictObject({
  index: z.number().int().min(0).max(99),
  runId: idSchema.nullable(),
  status: z.enum(["correct", "incorrect", "unavailable"]),
  outcomes: booleans,
  failure: failure.nullable(),
  steps: counts,
  durationMs: z.number().nonnegative(),
});
const caseCounts = z.strictObject({
  correct: z.number().int().min(0).max(100),
  incorrect: z.number().int().min(0).max(100),
  unavailable: z.number().int().min(0).max(100),
});
const rates = strictRecord(
  idSchema,
  caseCounts.extend({ accuracy: z.number().min(0).max(1).nullable() }),
);
const variantSchema = z.strictObject({
  kind: z.enum(["primary", "comparison"]),
  modelOverride: idSchema.nullable(),
  identities: z.array(modelIdentitySchema).max(32),
  requestedModels: z.array(idSchema).max(32),
  results: z.array(resultSchema).min(1).max(100),
  counts: caseCounts,
  steps: counts,
  outcomes: rates,
});
export type EvaluationCase = z.infer<typeof caseSchema>;
export type CaseEvaluation = z.infer<typeof resultSchema>;
export type VariantEvaluation = z.infer<typeof variantSchema>;
const same = (a: unknown, b: unknown) =>
  canonicalJson(a as Json) === canonicalJson(b as Json);
const keys = (v: object) => Object.keys(v).sort();

export const evaluationReportSchema = z
  .strictObject({
    id: idSchema,
    set: z.strictObject({
      id: idSchema,
      scope: z.literal("global"),
      hash: hashSchema,
    }),
    projectId: idSchema.nullable(),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    budgetMs: z.literal(EVALUATION_BUDGET_MS),
    configurationGeneration: z.number().int().nonnegative().safe(),
    stepsPerCase: z.number().int().min(1).max(16),
    plannedRequestsUpperBound: z.number().int().min(1).max(3200),
    cases: z.array(caseSchema).min(1).max(100),
    variants: z.array(variantSchema).min(1).max(2),
    disagreements: z
      .array(
        z.strictObject({
          index: z.number().int().min(0).max(99),
          status: z.enum(["agree", "disagree", "unavailable"]),
          outcomes: z.array(idSchema).max(64),
        }),
      )
      .max(100),
    complete: z.boolean(),
    stale: z.boolean(),
    failure: failure.nullable(),
    modelLabelLimitation: z.literal(MODEL_LABEL_LIMITATION),
  })
  .superRefine((report, ctx) => {
    const bad = () =>
      ctx.addIssue({ code: "custom", message: "inconsistent_evaluation" });
    if (!report.cases.length || !report.variants.length) {
      bad();
      return;
    }
    const outcomeIds = keys(report.cases[0]!.expect);
    const ids = report.cases.flatMap((c) => (c.id === null ? [] : [c.id]));
    if (
      !outcomeIds.length ||
      new Set(ids).size !== ids.length ||
      report.endedAt < report.startedAt
    )
      bad();
    if (
      report.plannedRequestsUpperBound !==
      report.stepsPerCase * report.cases.length * report.variants.length
    )
      bad();
    if (
      report.cases.some(
        (c, i) => c.index !== i || !same(keys(c.expect), outcomeIds),
      )
    )
      bad();
    const runIds: string[] = [];
    let allAvailable = true;
    for (const [variantIndex, variant] of report.variants.entries()) {
      if (
        variant.kind !== (variantIndex ? "comparison" : "primary") ||
        (variantIndex && variant.modelOverride === null) ||
        variant.results.length !== report.cases.length
      ) {
        bad();
        continue;
      }
      for (const [index, result] of variant.results.entries()) {
        const expected = report.cases[index]!.expect;
        const totalSteps =
          result.steps.ran + result.steps.skipped + result.steps.unavailable;
        if (
          result.index !== index ||
          totalSteps !== (result.runId === null ? 0 : report.stepsPerCase)
        )
          bad();
        if (result.runId !== null) runIds.push(result.runId);
        if (result.status === "unavailable") {
          allAvailable = false;
          if (result.failure === null || Object.keys(result.outcomes).length)
            bad();
        } else {
          const correct = same(result.outcomes, expected);
          if (
            result.runId === null ||
            result.failure !== null ||
            result.steps.unavailable !== 0 ||
            !same(keys(result.outcomes), outcomeIds) ||
            (result.status === "correct") !== correct
          )
            bad();
        }
      }
      const summary = summarize(report.cases, variant.results);
      if (
        !same(summary, {
          counts: variant.counts,
          steps: variant.steps,
          outcomes: variant.outcomes,
        })
      )
        bad();
      const identities = variant.identities.map(
        (i) => `${i.id}:${i.fingerprint}`,
      );
      if (
        new Set(identities).size !== identities.length ||
        new Set(variant.requestedModels).size !== variant.requestedModels.length
      )
        bad();
      if (
        variant.steps.ran > 0 !==
        (variant.identities.length > 0 && variant.requestedModels.length > 0)
      )
        bad();
    }
    if (new Set(runIds).size !== runIds.length) bad();
    if (
      report.variants.every((v) => v.results.length === report.cases.length) &&
      !same(report.disagreements, compare(report.variants))
    )
      bad();
    if (
      report.complete !==
      (allAvailable && !report.stale && report.failure === null)
    )
      bad();
  });
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export function parseEvaluationReport(value: unknown): EvaluationReport {
  assertJson(value, LIMITS.responseBytes, 12);
  const parsed = evaluationReportSchema.parse(value);
  assertLossless(value, parsed, LIMITS.responseBytes, 12);
  return parsed;
}
export const evaluationInputSchema = z
  .strictObject({
    id: idSchema,
    model: idSchema.optional(),
    compare: idSchema.optional(),
    projectId: idSchema.optional(),
  })
  .refine(
    (v) => v.compare === undefined || v.compare !== v.model,
    "distinct_comparison_required",
  );
export const calibrationSchema = z.strictObject({
  setId: idSchema,
  setHash: hashSchema,
  modelFingerprints: z
    .array(hashSchema)
    .min(1)
    .max(32)
    .refine((values) => new Set(values).size === values.length),
  testRunId: idSchema,
  acceptedAt: z.number().int().nonnegative(),
});
export const evaluationContracts = {
  test: { input: evaluationInputSchema, output: evaluationReportSchema },
  "tests.get": {
    input: z.strictObject({ id: idSchema }),
    output: evaluationReportSchema.nullable(),
  },
  "calibration.accept": {
    input: z.strictObject({ id: idSchema, run: idSchema }),
    output: calibrationSchema,
  },
  "calibration.get": {
    input: z.strictObject({ id: idSchema }),
    output: calibrationSchema.nullable(),
  },
};
