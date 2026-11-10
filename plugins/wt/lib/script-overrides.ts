import { z } from "zod";
const scriptStepSchema = z
  .object({
    mode: z.enum(["detected", "custom", "off"]),
    script: z.string().nullable(),
  })
  .refine(
    (step) =>
      step.mode !== "custom" ||
      (step.script !== null && step.script.trim().length > 0),
    "Custom scripts must not be empty",
  )
  .refine(
    (step) =>
      step.mode !== "custom" ||
      (step.script !== null &&
        new TextEncoder().encode(step.script).length <= 16384),
    "Scripts must be at most 16 KB",
  )
  // Inactive drafts must not block Off/Detected or consume database capacity.
  .transform((step) =>
    step.mode === "custom" ? step : { ...step, script: null },
  );
export const projectScriptsSchema = z.object({
  setup: scriptStepSchema,
  cleanup: scriptStepSchema,
});
export type ProjectScripts = z.infer<typeof projectScriptsSchema>;
