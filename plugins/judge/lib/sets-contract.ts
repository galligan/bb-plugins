import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { hashSchema } from "./results.ts";
import { LIMITS, canonicalJson, type Json } from "./json.ts";
import { parseSet, type QuestionSet } from "./sets-schema.ts";

export const yamlSchema = z
  .string()
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= LIMITS.definitionBytes,
    "definition_bytes",
  );
const definitionSchema = z.custom<QuestionSet>((value) => {
  try {
    return canonicalJson(parseSet(value)) === canonicalJson(value as Json);
  } catch {
    return false;
  }
});
export const setRecordSchema = z.strictObject({
  definition: definitionSchema,
  yaml: yamlSchema,
  hash: hashSchema,
  scope: z.literal("global"),
});
export const setListSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  after: idSchema.optional(),
  projectId: idSchema.optional(),
});
export const setContracts = {
  "sets.list": {
    input: setListSchema,
    output: z.strictObject({
      sets: z
        .array(
          z.strictObject({
            id: idSchema,
            description: z.string().max(4096),
            hash: hashSchema,
            projects: z.union([z.literal("all"), z.array(idSchema).max(100)]),
            applicable: z.boolean(),
          }),
        )
        .max(100),
      next: idSchema.nullable(),
    }),
  },
  "sets.show": {
    input: z.strictObject({ id: idSchema }),
    output: setRecordSchema.nullable(),
  },
  "sets.save": {
    input: z.strictObject({ yaml: yamlSchema }),
    output: setRecordSchema,
  },
  "sets.import": {
    input: z.strictObject({ yaml: yamlSchema }),
    output: setRecordSchema,
  },
  "sets.export": {
    input: z.strictObject({ id: idSchema }),
    output: z.strictObject({ yaml: yamlSchema }).nullable(),
  },
  "sets.remove": {
    input: z.strictObject({ id: idSchema }),
    output: z.strictObject({ removed: z.literal(true) }),
  },
  "projects.set": {
    input: z.strictObject({ projectId: idSchema, enabled: z.boolean() }),
    output: z.strictObject({ projectId: idSchema, enabled: z.boolean() }),
  },
} as const;
