import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../contracts.ts";
import { assertJson, LIMITS, type Json } from "../json.ts";
import type { Provenance } from "../results.ts";
import type { SourceDefinition } from "../sets-schema.ts";

export type SourceSdk = BbPluginApi["sdk"];
export const normalizedEventSchema = z.strictObject({
  kind: z.enum(["thread.idle", "turn.failed"]),
  threadId: idSchema,
  projectId: idSchema,
  requestId: idSchema.optional(),
  turnId: idSchema.nullable().optional(),
  attemptNumber: z.number().int().positive().optional(),
  inputAccepted: z.boolean().optional(),
  error: z.string().nullable().optional(),
});
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type SourceContext = {
  threadId?: string;
  projectId?: string;
  environmentId?: string;
  idle?: { lastAssistantText: string | null };
  event?: NormalizedEvent;
  signal?: AbortSignal;
  deadlineAt?: number;
};
export type SourceResult =
  | { status: "ok"; value: Json; sensitive: boolean; provenance: Provenance }
  | {
      status: "unavailable";
      reason:
        "source_unavailable" | "too_large" | "budget" | "timeout" | "cancelled";
      code: string;
    };
export class SourceFailure extends Error {
  readonly reason: "source_unavailable" | "too_large";
  readonly code: string;
  constructor(
    code: string,
    reason: "source_unavailable" | "too_large" = "source_unavailable",
  ) {
    super(code);
    this.code = code;
    this.reason = reason;
  }
}
export function sourceValue(
  value: Json,
  definition: SourceDefinition,
  sensitive: boolean,
  extra: Partial<Provenance> = {},
): SourceResult {
  try {
    assertJson(value, LIMITS.inputBytes);
  } catch {
    throw new SourceFailure("source_bytes", "too_large");
  }
  if (
    [...(typeof value === "string" ? value : JSON.stringify(value))].length >
    definition.maxChars
  )
    throw new SourceFailure("source_characters", "too_large");
  return {
    status: "ok",
    value,
    sensitive,
    provenance: {
      source: definition.from,
      observedAt: Date.now(),
      ...extra,
      selection: {
        maxChars: definition.maxChars,
        ...(definition.beforeSeq === undefined
          ? {}
          : { beforeSeq: definition.beforeSeq }),
        ...extra.selection,
      },
    },
  };
}
