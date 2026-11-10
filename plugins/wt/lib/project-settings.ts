import { z } from "zod";
import { isValidBranchPrefix } from "./branch-name.ts";
export const branchSettingsSchema = z.object({
  prefixBranches: z.boolean(),
  branchPrefix: z.string(),
});
export const projectSettingsSchema = z.object({
  version: z.literal(1),
  prefixBranches: z.boolean().nullable().optional(),
  branchPrefix: z
    .string()
    .refine(isValidBranchPrefix, "Not a valid start for a git branch name")
    .nullable()
    .optional(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export function effectiveBranchSettings(
  global: z.infer<typeof branchSettingsSchema>,
  project: ProjectSettings | null,
): z.infer<typeof branchSettingsSchema> {
  return {
    prefixBranches: project?.prefixBranches ?? global.prefixBranches,
    branchPrefix: project?.branchPrefix ?? global.branchPrefix,
  };
}
