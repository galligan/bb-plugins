import { z } from "zod";
import { badgeLabelSchema } from "./triggers-contract.ts";
import { idSchema, strictRecord } from "./contracts.ts";
import { hashSchema } from "./results.ts";
import { assertJson, assertLossless } from "./json.ts";
export const METADATA_BYTES = 32 * 1024;
export const SUMMARY_LIMIT = 20;
export const summarySchema = z.strictObject({
  runId: idSchema,
  setId: idSchema,
  setHash: hashSchema,
  triggerId: idSchema,
  triggerRevision: idSchema,
  timestamp: z.number().int().nonnegative(),
  outcomes: strictRecord(idSchema, z.boolean()).refine(
    (values) => Object.keys(values).length <= 64,
  ),
  complete: z.literal(true),
  calibrated: z.literal(true),
  badges: z
    .array(
      z.strictObject({
        outcome: idSchema,
        label: badgeLabelSchema,
      }),
    )
    .max(64),
});
export type VerdictSummary = z.infer<typeof summarySchema>;
export const metadataSchema = z
  .strictObject({
    verdicts: z.strictObject({
      version: z.literal(1),
      summaries: z.array(summarySchema).max(SUMMARY_LIMIT),
    }),
  })
  .superRefine((value, ctx) => {
    const ids = value.verdicts.summaries.map((s) => s.setId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "duplicate_set_summary" });
  });
export function parseMetadata(value: unknown) {
  assertJson(value, METADATA_BYTES, 8);
  const parsed = metadataSchema.parse(value);
  assertLossless(value, parsed, METADATA_BYTES, 8);
  return parsed;
}
export function boundedMetadata(values: VerdictSummary[]) {
  const summaries = [...values]
    .sort((a, b) => b.timestamp - a.timestamp || b.runId.localeCompare(a.runId))
    .slice(0, SUMMARY_LIMIT);
  while (
    summaries.length &&
    Buffer.byteLength(JSON.stringify({ verdicts: { version: 1, summaries } })) >
      METADATA_BYTES
  )
    summaries.pop();
  return parseMetadata({ verdicts: { version: 1, summaries } });
}
