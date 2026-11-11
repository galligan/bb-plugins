import { RadioError } from "./errors.ts";

export async function readHttpJson(
  request: Request,
  signal: AbortSignal,
  maxBytes = 262144,
): Promise<unknown> {
  signal.throwIfAborted();
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new RadioError("invalid_input", "Use application/json.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new RadioError(
      "invalid_input",
      `JSON input exceeds ${maxBytes} bytes or has an invalid length.`,
    );
  const reader = request.body?.getReader();
  if (!reader) throw new RadioError("invalid_input", "Supply a JSON body.");
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        cancel();
        throw new RadioError(
          "invalid_input",
          `JSON input exceeds ${maxBytes} bytes.`,
        );
      }
      bytes.set(next.value, size - next.value.byteLength);
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, size),
        ),
      );
    } catch {
      throw new RadioError("invalid_input", "Supply valid UTF-8 JSON.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
