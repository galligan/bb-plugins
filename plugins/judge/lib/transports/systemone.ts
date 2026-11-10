import {
  parseRequest,
  parseResponse,
  type ModelConfig,
  type Questions,
} from "../contracts.ts";
import { Deadline, OperationAborted } from "../deadline.ts";
import { ValidationError, type Json } from "../json.ts";
import { postJson, TransportFailure } from "./http.ts";

export type InferenceResult =
  | {
      status: "ran";
      providerModel: string;
      answers: ReturnType<typeof parseResponse>["answers"];
      inputTokens: number | null;
      latencyMs: number;
    }
  | {
      status: "unavailable";
      reason:
        | "timeout"
        | "budget"
        | "cancelled"
        | "error"
        | "too_large"
        | "invalid_response"
        | "private_not_allowed"
        | "not_configured";
      code: string;
      latencyMs: number;
    };

export type SystemOneOptions = {
  model: ModelConfig;
  endpoint: string;
  credential?: string;
  questions: Questions;
  state: Json;
  signals: (AbortSignal | undefined)[];
  deadlineAt: number;
  fetcher?: typeof fetch;
  decodeResponse?: (raw: unknown) => unknown;
};
export async function systemOne(
  options: SystemOneOptions,
): Promise<InferenceResult> {
  const start = performance.now();
  const scope = new Deadline({
    signals: options.signals,
    deadlineAt: options.deadlineAt,
    timeoutMs: options.model.timeoutMs,
  });
  try {
    scope.assertActive();
    const request = parseRequest({
      model: options.model.model,
      questions: options.questions,
      state: options.state,
    });
    if (Object.keys(request.questions).length > options.model.maxQuestions)
      return {
        status: "unavailable",
        reason: "too_large",
        code: "model_question_limit",
        latencyMs: performance.now() - start,
      };
    const response = await scope.run(() =>
      postJson({
        ...options,
        signals: [scope.signal],
        body: request,
        timeoutMs: options.model.timeoutMs,
        maxRequestBytes: options.model.maxRequestBytes,
        maxResponseBytes: options.model.maxResponseBytes,
      }),
    );
    // Parsing is bounded CPU work, but still shares the caller's deadline.
    scope.assertActive();
    let parsed;
    try {
      parsed = parseResponse(
        options.decodeResponse ? options.decodeResponse(response) : response,
        request.questions,
      );
    } catch (error) {
      if (error instanceof TransportFailure) throw error;
      throw new TransportFailure("invalid_response", "invalid_answers");
    }
    scope.assertActive();
    return {
      status: "ran",
      providerModel: parsed.model,
      answers: parsed.answers,
      inputTokens: parsed.inputTokens,
      latencyMs: performance.now() - start,
    };
  } catch (error) {
    if (error instanceof OperationAborted)
      return {
        status: "unavailable",
        reason: error.reason,
        code: error.reason,
        latencyMs: performance.now() - start,
      };
    if (error instanceof TransportFailure)
      return {
        status: "unavailable",
        reason: error.reason,
        code: error.code,
        latencyMs: performance.now() - start,
      };
    if (error instanceof ValidationError && error.message === "too_large")
      return {
        status: "unavailable",
        reason: "too_large",
        code: "request_bytes",
        latencyMs: performance.now() - start,
      };
    throw error; // Invalid definitions/arguments remain boundary errors.
  } finally {
    scope.close();
  }
}
