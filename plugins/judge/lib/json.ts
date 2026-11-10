import { createHash } from "node:crypto";

export const LIMITS = {
  questions: 64,
  steps: 16,
  inputs: 64,
  inputBytes: 64 * 1024,
  requestBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  definitionBytes: 256 * 1024,
  depth: 16,
  runs: 10_000,
  runAgeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export class ValidationError extends Error {
  constructor(code = "invalid_input") {
    super(code);
    this.name = "ValidationError";
  }
}

// Check before stringify: JSON.stringify silently drops/coerces non-JSON values.
export function assertJson(
  value: unknown,
  maxBytes: number = LIMITS.requestBytes,
): asserts value is Json {
  const active = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (depth > LIMITS.depth) throw new ValidationError("too_deep");
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || item === null)
      throw new ValidationError("non_json");
    if (active.has(item)) throw new ValidationError("non_json");
    const array = Array.isArray(item);
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new ValidationError("non_json");
    }
    active.add(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1)
      throw new ValidationError("non_json");
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (
        typeof key !== "string" ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        throw new ValidationError("non_json");
      }
      if (array && !/^(0|[1-9][0-9]*)$/.test(key))
        throw new ValidationError("non_json");
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
    throw new ValidationError("too_large");
}

export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value: Json): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
