import { z } from "zod";
import {
  assertJson,
  canonicalJson,
  LIMITS,
  ValidationError,
  type Json,
} from "./json.ts";

export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const probabilitySchema = z.number().min(0).max(1);
export const jsonSchema = z.custom<Json>((value) => {
  try {
    assertJson(value);
    return true;
  } catch {
    return false;
  }
});
const entrySchema = jsonSchema.refine(
  (v) => v === null || typeof v === "string" || typeof v === "object",
);
const instructionsSchema = entrySchema.refine((v) => v !== null);
const noulQuestion = z.strictObject({
  type: z.literal("noul"),
  instructions: instructionsSchema,
  criteria: z
    .strictObject({ true: entrySchema, false: entrySchema })
    .optional(),
});
const choiceQuestion = z.strictObject({
  type: z.literal("choice"),
  instructions: instructionsSchema,
  criteria: z
    .record(z.string().min(1).max(256), entrySchema)
    .refine((v) => Object.keys(v).length >= 2 && Object.keys(v).length <= 255),
});
const scoreQuestion = z.strictObject({
  type: z.literal("score"),
  instructions: instructionsSchema,
  criteria: z.array(entrySchema).min(2).max(10),
});
export const questionSchema = z.discriminatedUnion("type", [
  noulQuestion,
  choiceQuestion,
  scoreQuestion,
]);
export const questionsSchema = z
  .record(idSchema, questionSchema)
  .refine(
    (q) =>
      Object.keys(q).length > 0 && Object.keys(q).length <= LIMITS.questions,
  );
export type Question = z.infer<typeof questionSchema>;
export type Questions = z.infer<typeof questionsSchema>;

export const requestSchema = z.strictObject({
  model: z.string().min(1).max(256),
  state: jsonSchema,
  questions: questionsSchema,
});
export type InferenceRequest = z.infer<typeof requestSchema>;

export function parseRequest(value: unknown): InferenceRequest {
  assertJson(value);
  const request = requestSchema.parse(value);
  if (
    request.state !== null &&
    !Array.isArray(request.state) &&
    typeof request.state === "object"
  ) {
    if (Object.keys(request.state).length > LIMITS.inputs)
      throw new ValidationError("too_many_inputs");
    for (const input of Object.values(request.state))
      assertJson(input, LIMITS.inputBytes);
  } else assertJson(request.state, LIMITS.inputBytes);
  return request;
}

const distributionSchema = z
  .record(z.string(), probabilitySchema)
  .refine((p) => {
    const sum = Object.values(p).reduce((a, b) => a + b, 0);
    return Object.keys(p).length > 0 && Math.abs(sum - 1) <= 0.001;
  });
export const answerSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("noul"), noul: probabilitySchema }),
  z.strictObject({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probabilitySchema,
    probabilities: distributionSchema,
  }),
  z.strictObject({
    type: z.literal("score"),
    score: z.number(),
    confidence: probabilitySchema,
    legend: z.record(z.string(), entrySchema),
    probabilities: distributionSchema,
  }),
]);
export const answersSchema = z
  .record(idSchema, answerSchema)
  .refine(
    (answers) =>
      Object.keys(answers).length > 0 &&
      Object.keys(answers).length <= LIMITS.questions,
  );
export type Answer = z.infer<typeof answerSchema>;
export type Answers = z.infer<typeof answersSchema>;
const providerResponseSchema = z.strictObject({
  model: z.string().min(1).max(256),
  answers: answersSchema,
  usage: z
    .strictObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional(),
});

function sameKeys(a: object, keys: string[]): boolean {
  return (
    Object.keys(a).length === keys.length &&
    keys.every((key) => Object.hasOwn(a, key))
  );
}

/** Validate the entire batch against the submitted questions; confidence is not option probability. */
export function parseResponse(value: unknown, questions: Questions) {
  assertJson(value, LIMITS.responseBytes);
  const parsed = providerResponseSchema.parse(value);
  if (!sameKeys(parsed.answers, Object.keys(questions)))
    throw new ValidationError("answer_ids");
  for (const [id, question] of Object.entries(questions)) {
    const answer = parsed.answers[id]!;
    if (answer.type !== question.type) throw new ValidationError("answer_type");
    if (question.type === "choice" && answer.type === "choice") {
      const keys = Object.keys(question.criteria);
      if (
        !keys.includes(answer.choice) ||
        !sameKeys(answer.probabilities, keys)
      )
        throw new ValidationError("answer_options");
      if (
        answer.probabilities[answer.choice]! + 0.001 <
        Math.max(...Object.values(answer.probabilities))
      )
        throw new ValidationError("answer_choice");
    }
    if (question.type === "score" && answer.type === "score") {
      const keys = question.criteria.map((_, index) => String(index));
      if (
        !sameKeys(answer.probabilities, keys) ||
        !sameKeys(answer.legend, keys)
      )
        throw new ValidationError("answer_rubric");
      const expected = keys.reduce(
        (sum, key) => sum + Number(key) * answer.probabilities[key]!,
        0,
      );
      if (
        answer.score < 0 ||
        answer.score > keys.length - 1 ||
        Math.abs(answer.score - expected) > 0.001
      )
        throw new ValidationError("answer_score");
      for (const key of keys)
        if (
          canonicalJson(answer.legend[key]!) !==
          canonicalJson(question.criteria[Number(key)]!)
        )
          throw new ValidationError("answer_legend");
    }
  }
  return {
    model: parsed.model,
    answers: parsed.answers,
    inputTokens: parsed.usage?.input_tokens ?? null,
  };
}

export const modelConfigSchema = z.strictObject({
  id: idSchema,
  connection: z.enum(["typesafe", "cloudflare", "custom"]),
  model: z.string().min(1).max(256),
  allowPrivate: z.boolean().default(false),
  timeoutMs: z.number().int().min(1).max(30_000).default(2_000),
  maxQuestions: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.questions)
    .default(LIMITS.questions),
  maxRequestBytes: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.requestBytes)
    .default(LIMITS.requestBytes),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.responseBytes)
    .default(LIMITS.responseBytes),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;
