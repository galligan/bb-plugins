import { z } from "zod";
import { idSchema, strictRecord } from "./contracts.ts";
import { hashSchema } from "./results.ts";
import { assertJson, LIMITS } from "./json.ts";

export const triggerEventSchema = z.enum(["thread.idle", "turn.failed"]);
const projectsSchema = z.union([
  z.literal("all"),
  z
    .array(idSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
]);
export const badgeLabelSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((label) => label.trim().length > 0 && !/\p{Cc}/u.test(label));
export const triggerDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  id: idSchema,
  setId: idSchema,
  event: triggerEventSchema,
  projects: projectsSchema.default("all"),
  badges: strictRecord(idSchema, badgeLabelSchema)
    .refine((values) => Object.keys(values).length <= 64)
    .default({}),
});
export type TriggerDefinition = z.infer<typeof triggerDefinitionSchema>;
export const triggerRecordSchema = z.strictObject({
  definition: triggerDefinitionSchema,
  hash: hashSchema,
  revision: idSchema,
  enabled: z.boolean(),
});
export type TriggerRecord = z.infer<typeof triggerRecordSchema>;
export function parseTrigger(value: unknown): TriggerDefinition {
  assertJson(value, LIMITS.definitionBytes);
  return triggerDefinitionSchema.parse(value);
}
export const triggerPageSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).default(20),
  after: idSchema.optional(),
});
export const triggerContracts = {
  "triggers.list": {
    input: triggerPageSchema,
    output: z.strictObject({
      triggers: z.array(triggerRecordSchema).max(20),
      next: idSchema.nullable(),
    }),
  },
  "triggers.show": {
    input: z.strictObject({ id: idSchema }),
    output: triggerRecordSchema.nullable(),
  },
  "triggers.save": {
    input: triggerDefinitionSchema,
    output: triggerRecordSchema,
  },
  "triggers.remove": {
    input: z.strictObject({ id: idSchema }),
    output: z.strictObject({ removed: z.literal(true) }),
  },
  "triggers.enable": {
    input: z.strictObject({ id: idSchema, enabled: z.boolean() }),
    output: triggerRecordSchema,
  },
};
