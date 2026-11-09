import { parse } from "smol-toml";
import { z } from "zod";

export const BB_SETUP_HOOK = ".bb-env-setup.sh";
export const BB_TEARDOWN_HOOK = ".bb-env-teardown.sh";
export const CODEX_ENVIRONMENT = ".codex/environments/environment.toml";

/**
 * Where a worktree's setup and cleanup come from.
 *
 * - `bb-hook`: the repo commits bb's own hook files. bb core runs those itself
 *   after `create` and before `remove`, so this plugin runs nothing.
 * - `codex`: no bb hook, but the repo declares Codex environment scripts.
 * - `none`: a bare worktree.
 */
export type SetupPlan =
  | { source: "bb-hook" }
  | { source: "codex"; setup: string | null; cleanup: string | null }
  | { source: "none" };

const scriptTable = z.object({ script: z.string().min(1) }).optional();
const codexEnvironment = z.object({ setup: scriptTable, cleanup: scriptTable });

export function resolveSetupPlan(repo: {
  hasBbHook: boolean;
  codexEnvironmentToml: string | null;
}): SetupPlan {
  if (repo.hasBbHook) return { source: "bb-hook" };
  if (repo.codexEnvironmentToml === null) return { source: "none" };

  let parsed: z.infer<typeof codexEnvironment>;
  try {
    parsed = codexEnvironment.parse(parse(repo.codexEnvironmentToml));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${CODEX_ENVIRONMENT}: ${detail}`, {
      cause: error,
    });
  }
  const setup = parsed.setup?.script ?? null;
  const cleanup = parsed.cleanup?.script ?? null;
  return setup === null && cleanup === null
    ? { source: "none" }
    : { source: "codex", setup, cleanup };
}
