import { normalizeName } from "./names.ts";
import { RadioError } from "./errors.ts";
import { skipLiteral } from "./literal-regions.ts";

interface TokenText {
  original: string;
  canonical: string;
  corrected: boolean;
  start: number;
  end: number;
}
export type AddressToken = TokenText &
  (
    | { kind: "human" }
    | { kind: "participant"; name: string; project?: string }
    | {
        kind: "channel-reference" | "channel-audience";
        project: string;
        subchannel?: string;
      }
  );
export type BodyToken =
  AddressToken | (TokenText & { kind: "tag"; name: string });
const PART = "[\\p{L}\\p{M}\\p{N}_-]+";
const ADDRESS = new RegExp(`^(?:@|ch:|#)${PART}(?:[:/]${PART})*`, "iu");

export function parseBody(body: string): BodyToken[] {
  if (typeof body !== "string" || body.length > 16_384)
    throw new RadioError(
      "invalid_input",
      "Address parsing accepts at most 16384 raw characters.",
    );
  const tokens: BodyToken[] = [];
  for (let index = 0; index < body.length;) {
    const literalEnd = skipLiteral(body, index);
    if (literalEnd !== null) {
      index = literalEnd;
      continue;
    }
    const previous = body[index - 1] ?? "";
    if (/[\p{L}\p{N}_/@.:#-]/u.test(previous)) {
      index++;
      continue;
    }
    const match = ADDRESS.exec(body.slice(index));
    if (!match) {
      index++;
      continue;
    }
    const original = match[0];
    const end = index + original.length;
    const next = body[end] ?? "";
    const proseColon =
      !original.includes(":") && /\s/.test(body[end + 1] ?? "");
    if (
      next === "/" ||
      next === "@" ||
      (next === ":" && !proseColon) ||
      (next === "." && /[\p{L}\p{N}_-]/u.test(body[end + 1] ?? ""))
    )
      throw new RadioError(
        "invalid_input",
        "Malformed address; use project:handle or ch:project/subchannel with single-hyphen names.",
      );
    const base = { original, start: index, end };
    if (original.startsWith("#")) {
      if (/[:/]/.test(original))
        throw new RadioError("invalid_input", "A topic tag has one name.");
      const name = normalizeName(original.slice(1)).name;
      tokens.push({
        ...base,
        kind: "tag",
        name,
        canonical: `#${name}`,
        corrected: original !== `#${name}`,
      });
    } else if (/^@?ch:/i.test(original)) {
      const audience = original.startsWith("@");
      const parts = original.slice(audience ? 4 : 3).split("/");
      if (parts.length > 2 || parts.some((part) => !part || part.includes(":")))
        throw new RadioError(
          "invalid_input",
          "Use a project channel with at most one subchannel.",
        );
      const project = normalizeName(parts[0]!).name;
      const subchannel = parts[1] ? normalizeName(parts[1]).name : undefined;
      const canonical = `${audience ? "@" : ""}ch:${project}${subchannel ? `/${subchannel}` : ""}`;
      tokens.push({
        ...base,
        kind: audience ? "channel-audience" : "channel-reference",
        project,
        ...(subchannel ? { subchannel } : {}),
        canonical,
        corrected: original !== canonical,
      });
    } else {
      const parts = original.slice(1).split(":");
      if (parts.length > 2 || parts.some((part) => part.includes("/")))
        throw new RadioError(
          "invalid_input",
          "Use @handle or @project:handle.",
        );
      const name = normalizeName(parts.at(-1)!).name;
      if (parts.length === 1 && name === "user") {
        tokens.push({
          ...base,
          kind: "human",
          canonical: "@user",
          corrected: original !== "@user",
        });
      } else {
        if (name === "user" || name === "ch")
          throw new RadioError(
            "invalid_input",
            "Use reserved @user for the human; @ch: is channel addressing.",
          );
        const project =
          parts.length === 2 ? normalizeName(parts[0]!).name : undefined;
        const canonical = `@${project ? `${project}:` : ""}${name}`;
        tokens.push({
          ...base,
          kind: "participant",
          name,
          ...(project ? { project } : {}),
          canonical,
          corrected: original !== canonical,
        });
      }
    }
    index = end;
  }
  return tokens;
}
