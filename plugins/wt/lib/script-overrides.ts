import { z } from "zod";
const scriptStepSchema = z
  .object({
    mode: z.enum(["detected", "custom", "off"]),
    script: z
      .string()
      .refine(
        (text) => new TextEncoder().encode(text).length <= 16384,
        "Scripts must be at most 16 KB",
      )
      .nullable(),
  })
  .refine(
    (step) =>
      step.mode !== "custom" ||
      (step.script !== null && step.script.trim().length > 0),
    "Custom scripts must not be empty",
  );
export const projectScriptsSchema = z.object({
  setup: scriptStepSchema,
  cleanup: scriptStepSchema,
});
export type ProjectScripts = z.infer<typeof projectScriptsSchema>;
