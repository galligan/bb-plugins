import { z } from "zod";
import { idSchema, type Answers, type Questions } from "./contracts.ts";
import { ValidationError } from "./json.ts";

export type Expression =
  | string
  | { all: Expression[] }
  | { any: Expression[] }
  | { not: Expression }
  | { q: string; gte: number; is?: string }
  | { q: string; lte: number };
export const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z.string().min(3).max(257),
    z.strictObject({ all: z.array(expressionSchema).min(1).max(64) }),
    z.strictObject({ any: z.array(expressionSchema).min(1).max(64) }),
    z.strictObject({ not: expressionSchema }),
    z.strictObject({
      q: idSchema,
      gte: z.number(),
      is: z.string().min(1).max(256).optional(),
    }),
    z.strictObject({ q: idSchema, lte: z.number() }),
  ]),
);

export function validateExpression(
  expression: Expression,
  questions: Questions | null,
  earlier: Map<string, Set<string>>,
  depth = 0,
): void {
  if (depth > 16) throw new ValidationError("expression_depth");
  if (typeof expression === "string") {
    const parts = expression.split(".");
    if (parts.length !== 2 || !earlier.get(parts[0]!)?.has(parts[1]!))
      throw new ValidationError("unknown_outcome_reference");
  } else if ("all" in expression || "any" in expression) {
    for (const term of "all" in expression ? expression.all : expression.any)
      validateExpression(term, questions, earlier, depth + 1);
  } else if ("not" in expression)
    validateExpression(expression.not, questions, earlier, depth + 1);
  else {
    const question =
      questions && Object.hasOwn(questions, expression.q)
        ? questions[expression.q]
        : undefined;
    if (!question) throw new ValidationError("unknown_question_reference");
    const threshold = "gte" in expression ? expression.gte : expression.lte;
    const max = question.type === "score" ? question.criteria.length - 1 : 1;
    if (threshold < 0 || threshold > max)
      throw new ValidationError("predicate_range");
    if (question.type === "choice") {
      if (
        !("is" in expression) ||
        expression.is === undefined ||
        !Object.hasOwn(question.criteria, expression.is)
      )
        throw new ValidationError("choice_predicate");
    } else if ("is" in expression)
      throw new ValidationError("unexpected_choice_predicate");
  }
}

/** Missing evidence is an error, including beneath negation, never an actionable false. */
export function evaluateExpression(
  expression: Expression,
  answers: Answers,
  earlier: Record<string, Record<string, boolean>>,
  depth = 0,
): boolean {
  if (depth > 16) throw new ValidationError("expression_depth");
  if (typeof expression === "string") {
    const [step, name] = expression.split(".");
    if (
      !step ||
      !name ||
      !Object.hasOwn(earlier, step) ||
      !Object.hasOwn(earlier[step]!, name)
    )
      throw new ValidationError("missing_evidence");
    return earlier[step]![name]!;
  }
  if ("all" in expression || "any" in expression) {
    const terms = ("all" in expression ? expression.all : expression.any).map(
      (term) => evaluateExpression(term, answers, earlier, depth + 1),
    );
    return "all" in expression ? terms.every(Boolean) : terms.some(Boolean);
  }
  if ("not" in expression)
    return !evaluateExpression(expression.not, answers, earlier, depth + 1);
  if (!Object.hasOwn(answers, expression.q))
    throw new ValidationError("missing_evidence");
  const answer = answers[expression.q]!;
  if (answer.type === "choice") {
    if (
      !("is" in expression) ||
      expression.is === undefined ||
      !Object.hasOwn(answer.probabilities, expression.is)
    )
      throw new ValidationError("invalid_predicate");
    return (
      answer.choice === expression.is &&
      answer.probabilities[expression.is]! >= expression.gte
    );
  }
  if ("is" in expression) throw new ValidationError("invalid_predicate");
  const value = answer.type === "noul" ? answer.noul : answer.score;
  return "gte" in expression
    ? value >= expression.gte
    : value <= expression.lte;
}
