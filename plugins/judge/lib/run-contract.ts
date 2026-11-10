import { z } from "zod";
import { idSchema, jsonSchema, strictRecord } from "./contracts.ts";
import { assertJson, LIMITS, ValidationError } from "./json.ts";
import type { QuestionSet } from "./sets-schema.ts";

export const runSchema = z.strictObject({
  id: idSchema,
  threadId: idSchema.optional(),
  projectId: idSchema.optional(),
  model: idSchema.optional(),
  inputs: strictRecord(idSchema, strictRecord(idSchema, jsonSchema)).optional(),
});
export type RunInput = z.infer<typeof runSchema>;

export function validateOverrides(input: RunInput, set: QuestionSet): void {
  assertJson(input.inputs ?? {}, LIMITS.requestBytes, LIMITS.depth + 2);
  for (const [stepId, values] of Object.entries(input.inputs ?? {})) {
    const step = set.steps.find((s) => s.id === stepId);
    if (!step) throw new ValidationError("unknown_step_override");
    for (const [name, value] of Object.entries(values)) {
      if (!Object.hasOwn(step.inputs, name))
        throw new ValidationError("unknown_input_override");
      assertJson(value, LIMITS.inputBytes);
    }
  }
}
