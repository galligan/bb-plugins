import { z } from "zod";
export const rescueSchema = z.object({
  ref: z.string().regex(/^refs\/wt-rescue\//u),
  commit: z.string(),
  createdAt: z.number(),
  subject: z.string(),
});

/** Ref names can contain shell syntax even though Git forbids whitespace. */
export function restoreCommand(ref: string): string {
  return `git checkout '${ref.replaceAll("'", "'\\''")}' -- .`;
}
