// The label of the Rex window a thread's terminal lives in:
// `<thread title> [<thread id>]`.
//
// The title is for people, and can change. The ID is what ties the window
// back to its thread when someone reads the label in Rex, so when the two do
// not fit in a label, the title is the part that is shortened.

/** Rex takes a window label of up to 128 characters. */
const MAX_LABEL_BYTES = 128;
const UNTITLED = "Thread";
const ELLIPSIS = "…";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * The label for the window of the thread `threadId`, whose title is `title`.
 * Rex refuses a label with a control character in it, so those become spaces.
 * The limit is kept in bytes, which is the stricter reading of "characters".
 */
export function threadWindowLabel(
  title: string | null,
  threadId: string,
): string {
  const suffix = ` [${threadId}]`;
  const clean = (title ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const whole = clean === "" ? UNTITLED : clean;
  if (bytes(whole) + bytes(suffix) <= MAX_LABEL_BYTES) return whole + suffix;

  const room = MAX_LABEL_BYTES - bytes(suffix) - bytes(ELLIPSIS);
  let kept = "";
  // By code point, so a character is never cut in half.
  for (const character of whole) {
    if (bytes(kept) + bytes(character) > room) break;
    kept += character;
  }
  return kept.trimEnd() + ELLIPSIS + suffix;
}
