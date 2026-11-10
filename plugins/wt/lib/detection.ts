import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { detectionSchema } from "./detection-schema.ts";
import { readSetupPlan } from "./read-setup-plan.ts";
import {
  BB_SETUP_HOOK,
  BB_TEARDOWN_HOOK,
  CODEX_ENVIRONMENT,
} from "./setup-plan.ts";
import { listSharedFiles, WORKTREE_INCLUDE } from "./share.ts";
import { git } from "./process.ts";

/** Read checkout configuration, never shared file contents. No script is executed. */
export async function detectSetupPlan(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<z.infer<typeof detectionSchema>> {
  const hooks = {
    setup: existsSync(join(sourcePath, BB_SETUP_HOOK)),
    teardown: existsSync(join(sourcePath, BB_TEARDOWN_HOOK)),
  };
  const result: z.infer<typeof detectionSchema> = {
    source: hooks.setup || hooks.teardown ? "bb-hook" : "none",
    setup: null,
    cleanup: null,
    hooks,
    sharedFiles: {
      patternFile: existsSync(join(sourcePath, WORKTREE_INCLUDE)),
      files: [],
    },
    error: null,
  };
  const errors: string[] = [];
  try {
    result.sharedFiles.files = [
      ...(await listSharedFiles({
        repoPath: sourcePath,
        sourcePath,
        worktreePath: sourcePath,
        signal,
      })),
    ];
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    if (result.source !== "bb-hook") {
      // Even a symlink inside the checkout could target an ignored secret file.
      let path = sourcePath;
      for (const segment of CODEX_ENVIRONMENT.split("/")) {
        path = join(path, segment);
        if ((await lstat(path).catch(() => null))?.isSymbolicLink())
          throw new Error(
            "Script detection will not read a symlinked Codex configuration.",
          );
      }
      const ignored = await git(
        sourcePath,
        ["check-ignore", "-q", "--", CODEX_ENVIRONMENT],
        signal,
      );
      if (ignored.code === 0)
        throw new Error(
          "Codex configuration is git-ignored; its contents are not displayed.",
        );
      if (ignored.code !== 1)
        throw new Error(
          "Could not check whether the Codex configuration is ignored.",
        );
    }
    const plan = await readSetupPlan(sourcePath);
    result.source = plan.source;
    if (plan.source === "codex") {
      for (const step of ["setup", "cleanup"] satisfies (
        "setup" | "cleanup"
      )[]) {
        const script = plan[step];
        if (script !== null && Buffer.byteLength(script) > 16384) {
          result[step] = new TextDecoder().decode(
            new TextEncoder().encode(script).slice(0, 16381),
          );
          errors.push(`${step} script truncated to 16 KB for display.`);
        } else result[step] = script;
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  result.error = errors.length === 0 ? null : errors.join("\n");
  return detectionSchema.parse(result);
}
