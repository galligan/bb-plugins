import { z } from "zod";
export const detectionSchema = z.object({
  source: z.enum(["bb-hook", "codex", "none"]),
  setup: z.string().nullable(),
  cleanup: z.string().nullable(),
  hooks: z.object({ setup: z.boolean(), teardown: z.boolean() }),
  sharedFiles: z.object({
    patternFile: z.boolean(),
    files: z.array(z.string()),
  }),
  error: z.string().nullable(),
});
