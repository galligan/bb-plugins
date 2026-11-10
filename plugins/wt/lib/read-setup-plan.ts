import type { ProjectScripts } from "./script-overrides.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BB_SETUP_HOOK,
  BB_TEARDOWN_HOOK,
  CODEX_ENVIRONMENT,
  resolveSetupPlan,
  type SetupPlan,
} from "./setup-plan.ts";
export async function readSetupPlan(
  path: string,
  mode: ProjectScripts["setup"]["mode"] = "detected",
): Promise<SetupPlan> {
  const hasBbHook =
    existsSync(join(path, BB_SETUP_HOOK)) ||
    existsSync(join(path, BB_TEARDOWN_HOOK));
  if (hasBbHook) return { source: "bb-hook" };
  // Custom and Off do not depend on Codex configuration for this step.
  if (mode !== "detected") return { source: "none" };
  return resolveSetupPlan({
    hasBbHook,
    codexEnvironmentToml: await readFile(
      join(path, CODEX_ENVIRONMENT),
      "utf8",
    ).catch(() => null),
  });
}
