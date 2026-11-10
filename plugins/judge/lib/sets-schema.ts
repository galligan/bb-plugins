import { z } from "zod";
import {
  idSchema,
  jsonSchema,
  questionsSchema,
  strictRecord,
  parseRequest,
} from "./contracts.ts";
import { assertJson, LIMITS, ValidationError } from "./json.ts";
import { expressionSchema, validateExpression } from "./outcomes.ts";

export const sourceIdSchema = z.enum([
  "thread.title",
  "thread.lastAssistantText",
  "thread.commands",
  "thread.commandOutput",
  "thread.recentUserMessages",
  "thread.goal",
  "git.changedFiles",
  "git.status",
  "git.diff",
  "project.name",
  "provider.id",
  "provider.model",
  "event.threadId",
  "event.projectId",
  "event.requestId",
  "event.turnId",
  "event.attemptNumber",
  "event.inputAccepted",
  "event.error",
]);
export const sourceSchema = z
  .strictObject({
    from: sourceIdSchema,
    maxChars: z.number().int().min(1).max(65_536).default(12_000),
    count: z.number().int().min(1).max(100).optional(),
    beforeSeq: z.number().int().nonnegative().optional(),
    target: z.enum(["uncommitted", "branch"]).optional(),
    base: z.string().min(1).max(256).optional(),
  })
  .superRefine((s, ctx) => {
    if (
      ![
        "thread.commands",
        "thread.commandOutput",
        "thread.recentUserMessages",
        "thread.goal",
      ].includes(s.from) &&
      (s.count !== undefined || s.beforeSeq !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "history_options_only" });
    if (
      s.from.startsWith("git.") &&
      (!s.target || (s.target === "branch" && !s.base))
    )
      ctx.addIssue({ code: "custom", message: "git_target_required" });
    if (!s.from.startsWith("git.") && (s.target || s.base))
      ctx.addIssue({ code: "custom", message: "git_options_only" });
    if (s.target === "uncommitted" && s.base)
      ctx.addIssue({ code: "custom", message: "unexpected_base" });
  });
export type SourceDefinition = z.infer<typeof sourceSchema>;
const inputsSchema = strictRecord(idSchema, sourceSchema).refine(
  (v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 64,
);
const outcomesSchema = strictRecord(idSchema, expressionSchema).refine(
  (v) => Object.keys(v).length <= 64,
);
export const stepSchema = z.strictObject({
  id: idSchema,
  inputs: inputsSchema,
  questions: questionsSchema,
  outcomes: outcomesSchema,
  model: idSchema.optional(),
  when: expressionSchema.optional(),
});
export type StepDefinition = z.infer<typeof stepSchema>;
const caseInputs = strictRecord(idSchema, jsonSchema);
const rawCaseSchema = z.strictObject({
  id: idSchema.optional(),
  inputs: caseInputs,
  expect: strictRecord(idSchema, z.boolean()),
});
const common = {
  schemaVersion: z.literal(1),
  id: idSchema,
  description: z.string().min(1).max(4096),
  model: idSchema.optional(),
  projects: z
    .union([z.literal("all"), z.array(idSchema).min(1).max(100)])
    .default("all"),
  budgetMs: z.number().int().min(1).max(30_000).default(5_000),
  calibratedFor: z.array(idSchema).max(100).default([]),
  cases: z.array(rawCaseSchema).max(100).default([]),
};
const rawSchema = z.union([
  z.strictObject({
    ...common,
    inputs: inputsSchema,
    questions: questionsSchema,
    outcomes: outcomesSchema,
  }),
  z.strictObject({
    ...common,
    steps: z.array(stepSchema).min(1).max(16),
    outcomes: outcomesSchema,
  }),
]);
export type QuestionSet = Omit<
  z.infer<typeof rawSchema>,
  "cases" | "inputs" | "questions"
> & {
  steps: StepDefinition[];
  cases: {
    id?: string;
    inputs: Record<string, Record<string, z.infer<typeof jsonSchema>>>;
    expect: Record<string, boolean>;
  }[];
};

function unique(ids: string[]): void {
  if (ids.length !== new Set(ids).size)
    throw new ValidationError("duplicate_id");
}
function sameKeys(value: object, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

export function parseSet(value: unknown): QuestionSet {
  // Definition wrappers have their own bounded envelope; expressions remain capped at16.
  assertJson(value, LIMITS.definitionBytes, 48);
  const raw = rawSchema.parse(value);
  const shorthand = !("steps" in raw);
  const steps: StepDefinition[] =
    "steps" in raw
      ? raw.steps
      : [
          {
            id: "main",
            inputs: raw.inputs,
            questions: raw.questions,
            outcomes: raw.outcomes,
          },
        ];
  unique(steps.map((step) => step.id));
  unique(raw.calibratedFor);
  if (raw.projects !== "all") unique(raw.projects);
  unique(raw.cases.flatMap((c) => (c.id ? [c.id] : [])));
  if (!Object.keys(raw.outcomes).length)
    throw new ValidationError("empty_outcomes");
  const earlier = new Map<string, Set<string>>();
  for (const step of steps) {
    parseRequest({
      model: "validation",
      state: null,
      questions: step.questions,
    });
    if (step.when !== undefined) validateExpression(step.when, null, earlier);
    for (const expression of Object.values(step.outcomes))
      validateExpression(expression, step.questions, earlier);
    earlier.set(step.id, new Set(Object.keys(step.outcomes)));
  }
  // Shorthand outcomes are evaluated within main; normalized final outcomes reference main only.
  const outcomes = shorthand
    ? Object.fromEntries(
        Object.keys(raw.outcomes).map((id) => [id, `main.${id}`]),
      )
    : raw.outcomes;
  for (const expression of Object.values(outcomes))
    validateExpression(expression, null, earlier);
  const cases = raw.cases.map((c) => {
    let inputs: Record<string, z.infer<typeof jsonSchema>> = c.inputs;
    if (shorthand) {
      const names = Object.keys(steps[0]!.inputs);
      const flat = sameKeys(c.inputs, names);
      const main = c.inputs.main;
      const nested =
        sameKeys(c.inputs, ["main"]) &&
        main !== null &&
        typeof main === "object" &&
        !Array.isArray(main) &&
        sameKeys(main, names);
      if (flat && nested) throw new ValidationError("ambiguous_case_inputs");
      if (!nested) inputs = { main: c.inputs };
    }
    if (
      !sameKeys(
        inputs,
        steps.map((s) => s.id),
      ) ||
      !sameKeys(c.expect, Object.keys(outcomes))
    )
      throw new ValidationError("case_keys");
    const normalized: Record<
      string,
      Record<string, z.infer<typeof jsonSchema>>
    > = {};
    for (const step of steps) {
      const values = inputs[step.id];
      if (
        values === null ||
        typeof values !== "object" ||
        Array.isArray(values) ||
        !values ||
        !sameKeys(values, Object.keys(step.inputs))
      )
        throw new ValidationError("case_inputs");
      for (const input of Object.values(values))
        assertJson(input, LIMITS.inputBytes);
      normalized[step.id] = values;
    }
    return {
      ...(c.id ? { id: c.id } : {}),
      inputs: normalized,
      expect: c.expect,
    };
  });
  const result = {
    schemaVersion: raw.schemaVersion,
    id: raw.id,
    description: raw.description,
    ...(raw.model ? { model: raw.model } : {}),
    projects: raw.projects,
    budgetMs: raw.budgetMs,
    calibratedFor: raw.calibratedFor,
    steps,
    outcomes,
    cases,
  };
  assertJson(result, LIMITS.definitionBytes, 48);
  return result;
}
