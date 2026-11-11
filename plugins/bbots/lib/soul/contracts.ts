import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { changeSchema, documentSchema, idSchema } from "../storage/schema.ts";

export const executionSchema = z.strictObject({
  providerId: idSchema.optional(),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningLevel: z.string().trim().min(1).max(128).optional(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]).optional(),
  serviceTier: z.string().min(1).max(128).optional(),
});
export const defaultsSchema = z.strictObject({
  main: executionSchema,
  worker: executionSchema.nullable(),
  fallback: executionSchema.omit({ permissionMode: true }).nullable(),
});
export type ExecutionDefaults = z.infer<typeof defaultsSchema>;
const target = z.strictObject({ botId: idSchema });
export const soulWriteSchema = changeSchema.extend({
  botId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  markdown: z
    .string()
    .min(1)
    .max(16000)
    .refine((text) => text.trim().length > 0, "SOUL.md must not be blank"),
});
export const defaultsWriteSchema = changeSchema.extend({
  botId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  defaults: defaultsSchema,
});
export const soulStateSchema = z.strictObject({
  current: documentSchema.nullable(),
  lastSuppliedRevision: z.number().int().positive().nullable(),
  lastSuppliedAt: z.string().nullable(),
  appliedRevision: z.null(),
  pending: z.enum(["not-supplied", "newer-revision", "unverified"]),
  limitation: z.string(),
});
export const defaultsStateSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  defaults: defaultsSchema,
  effectiveWorker: executionSchema,
  scope: z.literal("future-conversations"),
  automaticFallback: z.literal("disabled"),
});
export const soulContract = defineRpcContract({
  soulShow: { input: target, output: soulStateSchema, tags: () => ["bots"] },
  soulUpdate: { input: soulWriteSchema, output: soulStateSchema },
  defaultsShow: {
    input: target,
    output: defaultsStateSchema,
    tags: () => ["bots"],
  },
  defaultsUpdate: { input: defaultsWriteSchema, output: defaultsStateSchema },
});
