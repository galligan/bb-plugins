import { z } from "zod";
import { ValidationError } from "../json.ts";
import {
  systemOne,
  type SystemOneOptions,
  type InferenceResult,
} from "./systemone.ts";
import { contextLimit, TransportFailure } from "./http.ts";

// Each window is verified against its own official model page. Byte caps are
// conservative product guards, not a tokenizer/context packing guarantee.
export const WORKERS_LIMITS = {
  clef: { contextTokens: 65_536, requestBytes: 48 * 1024 },
  "clef-flash": { contextTokens: 24_576, requestBytes: 16 * 1024 },
} as const;
const diagnostic = z.object({
  code: z.union([z.number().int(), z.string().max(128)]),
  message: z.string().max(4096),
});
const envelopeSchema = z.strictObject({
  success: z.boolean(),
  result: z.unknown().optional(),
  errors: z.array(diagnostic).max(64),
  messages: z.array(diagnostic).max(64),
});

function unwrap(raw: unknown, contextTokens: number): unknown {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success)
    throw new TransportFailure("invalid_response", "invalid_envelope");
  const { success, result, errors, messages } = envelope.data;
  if (!success || errors.length > 0) {
    const diagnostics = [...errors, ...messages];
    if (diagnostics.some(contextLimit))
      throw new TransportFailure("too_large", "provider_context_limit");
    if (
      diagnostics.some((d) =>
        /auth|unauthorized|permission denied/i.test(d.message),
      )
    )
      throw new TransportFailure("error", "authentication_failed");
    if (
      diagnostics.some((d) => /rate.limit|too many requests/i.test(d.message))
    )
      throw new TransportFailure("error", "rate_limited");
    if (
      diagnostics.some((d) =>
        /unsupported model|unknown model|model not found/i.test(d.message),
      )
    )
      throw new TransportFailure("error", "unsupported_model");
    throw new TransportFailure("error", "provider_error");
  }
  // Workers AI documents automatic text truncation at its context boundary.
  // Never accept a response that reports consuming the entire context window.
  const usage = (result as { usage?: { input_tokens?: unknown } } | null)
    ?.usage;
  if (
    typeof usage?.input_tokens === "number" &&
    usage.input_tokens >= contextTokens
  )
    throw new TransportFailure("too_large", "provider_context_limit");
  return result;
}

export async function workersAI(
  options: SystemOneOptions,
): Promise<InferenceResult> {
  if (
    options.model.connection !== "cloudflare" ||
    !Object.hasOwn(WORKERS_LIMITS, options.model.model)
  )
    throw new ValidationError("unsupported_model");
  const limits =
    WORKERS_LIMITS[options.model.model as keyof typeof WORKERS_LIMITS];
  if (Object.keys(options.questions).some((id) => id.length > 100))
    return {
      status: "unavailable",
      reason: "too_large",
      code: "provider_question_id_limit",
      latencyMs: 0,
    };
  return systemOne({
    ...options,
    model: {
      ...options.model,
      maxRequestBytes: Math.min(
        options.model.maxRequestBytes,
        limits.requestBytes,
      ),
    },
    decodeResponse: (raw) => unwrap(raw, limits.contextTokens),
  });
}
