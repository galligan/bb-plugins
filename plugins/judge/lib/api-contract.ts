import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  idSchema,
  jsonSchema,
  modelConfigSchema,
  questionsSchema,
} from "./contracts.ts";
import { probeStatusSchema } from "./connections.ts";
import { verdictSchema, runSummarySchema } from "./results.ts";
import { setContracts } from "./sets-contract.ts";
import { runSchema } from "./run-contract.ts";

export const askSchema = z.strictObject({
  state: jsonSchema,
  questions: questionsSchema,
  model: idSchema.optional(),
  notPrivate: z.boolean().default(false),
  threadId: idSchema.optional(),
  projectId: idSchema.optional(),
});
export const defaultsSchema = z.strictObject({
  defaultId: idSchema.nullable(),
  privateId: idSchema.nullable(),
});
export const modelCheckSchema = z.strictObject({
  modelId: idSchema,
  status: z.union([
    probeStatusSchema,
    z.enum(["configured", "not_configured", "cancelled"]),
  ]),
  code: idSchema,
  nextAction: z.string().max(512),
  tested: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
});
export const modelPageSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  after: idSchema.optional(),
});
export const logSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  setId: idSchema.optional(),
  threadId: idSchema.optional(),
  before: z
    .strictObject({
      startedAt: z.number().int().nonnegative(),
      runId: idSchema,
    })
    .optional(),
});
export const rpcContract = defineRpcContract({
  ...setContracts,
  ask: { input: askSchema, output: verdictSchema },
  run: { input: runSchema, output: verdictSchema },
  "models.list": {
    input: modelPageSchema,
    output: z.strictObject({
      models: z.array(modelConfigSchema).max(100),
      defaults: defaultsSchema,
      next: idSchema.nullable(),
    }),
  },
  "models.add": { input: modelConfigSchema, output: modelConfigSchema },
  "models.default": {
    input: z.strictObject({
      id: idSchema.nullable(),
      private: z.boolean().default(false),
    }),
    output: defaultsSchema,
  },
  "models.check": {
    input: z.strictObject({ id: idSchema, probe: z.boolean().default(false) }),
    output: modelCheckSchema,
  },
  log: {
    input: logSchema,
    output: z.strictObject({
      runs: z.array(runSummarySchema).max(100),
      next: logSchema.shape.before.unwrap().nullable(),
    }),
  },
  "runs.get": {
    input: z.strictObject({ id: idSchema }),
    output: verdictSchema.nullable(),
  },
});
