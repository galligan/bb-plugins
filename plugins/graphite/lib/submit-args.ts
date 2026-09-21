/** Only named, non-interactive submit options may reach Graphite. */
const SUBMIT_FLAGS = new Set([
  "--publish",
  "--merge-when-ready",
  "--update-only",
  "--draft",
]);

export function submitArgs(
  argv: readonly string[],
):
  | { readonly ok: true; readonly args: string[] }
  | { readonly ok: false; readonly error: string } {
  const args: string[] = [];
  for (const arg of argv) {
    if (!SUBMIT_FLAGS.has(arg)) {
      return { ok: false, error: `Unknown submit option: ${arg}` };
    }
    args.push(arg);
  }
  return { ok: true, args };
}
