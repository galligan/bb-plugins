import { Deadline, OperationAborted } from "../deadline.ts";
import { ValidationError, type Json } from "../json.ts";

export class TransportFailure extends Error {
  readonly reason: "error" | "too_large" | "invalid_response";
  readonly code: string;
  constructor(reason: TransportFailure["reason"], code: string) {
    super(code);
    this.reason = reason;
    this.code = code;
  }
}

async function readJson(
  response: Response,
  maxBytes: number,
  scope: Deadline,
): Promise<unknown> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && Number(advertised) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new TransportFailure("too_large", "response_bytes");
  }
  if (!response.body)
    throw new TransportFailure("invalid_response", "empty_response");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      scope.assertActive();
      const chunk = await scope.run(() => reader.read());
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes)
        throw new TransportFailure("too_large", "response_bytes");
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      );
    } catch {
      throw new TransportFailure("invalid_response", "invalid_json");
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function contextLimit(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  const detail = typeof error === "object" && error !== null ? error : body;
  const code = (detail as { code?: unknown }).code;
  if (
    [
      "context_length_exceeded",
      "context_window_exceeded",
      "too_many_tokens",
      "max_tokens_exceeded",
    ].includes(String(code))
  )
    return true;
  const message = (detail as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    message.length <= 4096 &&
    /context (length|window|limit)|maximum context|too many (input )?tokens|token limit/i.test(
      message,
    )
  );
}

/** One POST only; no redirects/retries and no upstream error text escapes. */
export async function postJson(options: {
  endpoint: string;
  credential?: string;
  body: Json;
  maxRequestBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
  deadlineAt: number;
  signals: (AbortSignal | undefined)[];
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const scope = new Deadline(options);
  try {
    scope.assertActive();
    const body = JSON.stringify(options.body);
    if (Buffer.byteLength(body, "utf8") > options.maxRequestBytes)
      throw new TransportFailure("too_large", "request_bytes");
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (options.credential)
      headers.authorization = `Bearer ${options.credential}`;
    return await scope.run(async () => {
      const response = await (options.fetcher ?? fetch)(options.endpoint, {
        method: "POST",
        headers,
        body,
        signal: scope.signal,
        redirect: "error",
      });
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        throw new TransportFailure("error", "redirect_rejected");
      }
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {});
        throw new TransportFailure("error", "authentication_failed");
      }
      if (response.status === 413) {
        void response.body?.cancel().catch(() => {});
        throw new TransportFailure("too_large", "provider_context_limit");
      }
      if (!response.ok && response.status !== 400 && response.status !== 422) {
        void response.body?.cancel().catch(() => {});
        throw new TransportFailure(
          "error",
          response.status === 429 ? "rate_limited" : `http_${response.status}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = await readJson(response, options.maxResponseBytes, scope);
      } catch (error) {
        if (
          !response.ok &&
          error instanceof TransportFailure &&
          error.reason === "invalid_response"
        )
          throw new TransportFailure("error", `http_${response.status}`);
        throw error;
      }
      if (!response.ok) {
        if (
          (response.status === 400 || response.status === 422) &&
          contextLimit(parsed)
        )
          throw new TransportFailure("too_large", "provider_context_limit");
        throw new TransportFailure(
          "error",
          response.status === 429 ? "rate_limited" : `http_${response.status}`,
        );
      }
      return parsed;
    });
  } catch (error) {
    if (
      error instanceof OperationAborted ||
      error instanceof TransportFailure ||
      error instanceof ValidationError
    )
      throw error;
    scope.assertActive();
    throw new TransportFailure("error", "network_error");
  } finally {
    scope.close();
  }
}
