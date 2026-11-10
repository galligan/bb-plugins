import { RadioError } from "./errors.ts";

export const NAME_MAX = 64;
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NormalizedName {
  requested: string;
  name: string;
  corrected: boolean;
}

export function normalizeName(requested: string): NormalizedName {
  if (typeof requested !== "string" || requested.length > 256)
    throw new RadioError(
      "invalid_input",
      "Names must contain at most 256 input characters.",
    );
  const name = requested
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name || name.length > NAME_MAX)
    throw new RadioError(
      "invalid_input",
      `Choose a name with 1–${NAME_MAX} letters/digits and single hyphens.`,
    );
  return { requested, name, corrected: requested !== name };
}
