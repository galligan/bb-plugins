import { z } from "zod";
import {
  answersSchema,
  idSchema,
  jsonSchema,
  strictRecord,
} from "./contracts.ts";
import { assertJson, assertLossless, LIMITS } from "./json.ts";

export const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timeSchema = z.number().int().nonnegative();
export const unavailableReasonSchema = z.enum([
  "timeout",
  "error",
  "too_large",
  "budget",
  "private_not_allowed",
  "source_unavailable",
  "not_configured",
  "invalid_response",
  "cancelled",
]);
export const modelIdentitySchema = z.strictObject({
  id: idSchema,
  connection: z.enum(["typesafe", "cloudflare", "custom"]),
  model: z.string().min(1).max(256),
  fingerprint: hashSchema,
});
export const provenanceSchema = z.strictObject({
  source: z.string().min(1).max(128),
  observedAt: timeSchema,
  selection: z.strictObject({
    maxChars: z.number().int().positive().optional(),
    count: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().nonnegative().optional(),
    target: z.enum(["uncommitted", "branch"]).optional(),
    environmentId: idSchema.optional(),
    base: z.string().min(1).max(256).optional(),
    truncated: z.boolean().optional(),
  }),
  sequence: z.number().int().nonnegative().optional(),
  revision: z.string().max(128).optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;
export const stepResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ran"),
    requestedModel: idSchema,
    resolvedModel: modelIdentitySchema,
    providerModel: z.string().min(1).max(256).optional(),
    fallbackReason: z.literal("private_not_allowed").nullable(),
    answers: answersSchema,
    outcomes: strictRecord(idSchema, z.boolean()),
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    cacheHit: z.boolean(),
    provenance: strictRecord(idSchema, provenanceSchema),
  }),
  z.strictObject({
    status: z.literal("skipped"),
    reason: z.enum(["gate_false", "upstream_unavailable"]),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: unavailableReasonSchema,
    code: idSchema,
  }),
]);
export type StepResult = z.infer<typeof stepResultSchema>;
export const verdictSchema = z
  .strictObject({
    runId: idSchema,
    set: z
      .strictObject({
        id: idSchema,
        scope: z.literal("global"),
        hash: hashSchema,
      })
      .nullable(),
    threadId: idSchema.nullable(),
    projectId: idSchema.nullable(),
    startedAt: timeSchema,
    endedAt: timeSchema,
    complete: z.boolean(),
    calibrated: z.boolean(),
    failure: z
      .strictObject({ reason: unavailableReasonSchema, code: idSchema })
      .optional(),
    steps: strictRecord(idSchema, stepResultSchema).refine(
      (s) => Object.keys(s).length > 0 && Object.keys(s).length <= LIMITS.steps,
    ),
    outcomes: strictRecord(idSchema, z.boolean()),
  })
  .superRefine((v, ctx) => {
    const results = Object.values(v.steps);
    const unavailable =
      v.failure !== undefined ||
      results.some(
        (s) =>
          s.status === "unavailable" ||
          (s.status === "skipped" && s.reason === "upstream_unavailable"),
      );
    if (
      v.endedAt < v.startedAt ||
      v.complete === unavailable ||
      (!v.complete && (Object.keys(v.outcomes).length > 0 || v.calibrated))
    ) {
      ctx.addIssue({ code: "custom", message: "inconsistent_verdict" });
    }
    if (
      v.set === null &&
      (v.calibrated ||
        v.failure !== undefined ||
        Object.keys(v.steps).length !== 1 ||
        !Object.hasOwn(v.steps, "main"))
    ) {
      ctx.addIssue({ code: "custom", message: "ad_hoc_identity" });
    }
  });
export type Verdict = z.infer<typeof verdictSchema>;
const v = verdictSchema.shape;
export const runSummarySchema = z.strictObject({
  runId: v.runId,
  set: v.set,
  threadId: v.threadId,
  projectId: v.projectId,
  startedAt: v.startedAt,
  endedAt: v.endedAt,
  complete: v.complete,
  calibrated: v.calibrated,
  failure: v.failure,
});

export function parseVerdict(value: unknown): Verdict {
  // A set can contain sixteen separately bounded provider responses.
  const maxBytes = LIMITS.steps * LIMITS.responseBytes + LIMITS.requestBytes;
  // steps/<id> adds two fixed levels around an already validated response.
  assertJson(value, maxBytes, LIMITS.depth + 2);
  const verdict = verdictSchema.parse(value);
  assertLossless(value, verdict, maxBytes, LIMITS.depth + 2);
  for (const step of Object.values(verdict.steps)) {
    assertJson(step, LIMITS.responseBytes + LIMITS.requestBytes);
  }
  return verdict;
}

// JSON-only interfaces for later repositories. No execution semantics are stored here.
export interface StoredSet {
  id: string;
  schemaVersion: 1;
  scope: "global";
  hash: string;
  yaml: string;
}
export interface CalibrationAcceptance {
  setHash: string;
  modelFingerprints: string[];
  testRunId: string;
  acceptedAt: number;
}
export interface CachedResponse {
  key: string;
  response: z.infer<typeof jsonSchema>;
  createdAt: number;
}
