import { RadioError } from "./errors.ts";

/** Return the first index after a literal region, or null for ordinary prose. */
export function skipLiteral(body: string, index: number): number | null {
  const char = body[index]!;
  const lineStart = index === 0 || body[index - 1] === "\n";
  if (lineStart) {
    const line = body.slice(
      index,
      body.indexOf("\n", index) < 0 ? body.length : body.indexOf("\n", index),
    );
    if (/^ {0,3}>/.test(line) || /^ {4}/.test(line)) return index + line.length;
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1]![0]!;
      const size = fence[1]!.length;
      let cursor = index + line.length + 1;
      while (cursor < body.length) {
        const end = body.indexOf("\n", cursor);
        const next = body.slice(cursor, end < 0 ? body.length : end);
        const closing = /^ {0,3}(`+|~+)[ \t\r]*$/.exec(next);
        if (closing && closing[1]![0] === marker && closing[1]!.length >= size)
          return end < 0 ? body.length : end + 1;
        cursor = end < 0 ? body.length : end + 1;
      }
      return body.length;
    }
  }
  if (char === "\\") return Math.min(index + 2, body.length);
  if (char === "`") {
    let size = 1;
    while (body[index + size] === "`") size++;
    let cursor = index + size;
    while (cursor < body.length) {
      if (body[cursor] !== "`") {
        cursor++;
        continue;
      }
      let run = 1;
      while (body[cursor + run] === "`") run++;
      if (run === size) return cursor + run;
      cursor += run;
    }
    return body.length;
  }
  const closing: Record<string, string> = {
    '"': '"',
    "'": "'",
    "“": "”",
    "‘": "’",
  };
  if (!closing[char]) return null;
  const previous = body[index - 1] ?? "";
  if ((char === "'" || char === "‘") && /[\p{L}\p{N}]/u.test(previous))
    return null;
  if (char === '"' && /[0-9]/.test(previous)) return null;
  for (let cursor = index + 1; cursor < body.length; cursor++) {
    if (body[cursor] === "\\") {
      cursor++;
      continue;
    }
    if (body[cursor] === closing[char]) {
      if (
        (char === "'" || char === "‘") &&
        /[\p{L}\p{N}]/u.test(body[cursor - 1] ?? "") &&
        /[\p{L}\p{N}]/u.test(body[cursor + 1] ?? "")
      )
        continue;
      return cursor + 1;
    }
  }
  throw new RadioError(
    "invalid_input",
    "Close or escape an unmatched opening quote before resolving addresses.",
  );
}
