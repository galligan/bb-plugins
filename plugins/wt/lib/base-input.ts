// The "Branch from:" control's value, shared by the picker and its tests. The
// provider's inputs are `{ base?: string }`; anything else reads as no choice.

/** The base branch carried by a provider inputs value, or null. */
export function readBase(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const base = "base" in value ? value.base : undefined;
  return typeof base === "string" && base !== "" ? base : null;
}

/** The provider inputs for a picked base branch; null means the default. */
export function toInputs(base: string | null): { base?: string } {
  return base === null ? {} : { base };
}
