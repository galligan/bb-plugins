// Running the Graphite CLI.
//
// Two rules from docs/agents/graphite.md, both learned the hard way:
//
//   - `gt` is not necessarily on the workspace host's PATH. Resolve it.
//   - `gt` MUST NOT be invoked in a form that can prompt. `--no-interactive`
//     always; `-f` on the verbs that ask. `gt merge --confirm` *asks*, despite
//     what the flag looks like, and fails outright in a non-interactive session.
//
// No BB SDK here: the guard that decides whether a verb may run lives with the
// caller, which is the only place that can read `environments.status`.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GT_TIMEOUT_MS = 120_000;
const GT_MAX_BUFFER = 8 * 1024 * 1024;

/** Where `gt` lands for the common installers, tried in order after PATH. */
const KNOWN_PATHS: readonly string[] = [
  join(homedir(), ".local/share/npm/bin/gt"),
  "/opt/homebrew/bin/gt",
  "/usr/local/bin/gt",
  join(homedir(), ".npm-global/bin/gt"),
];

export type GtResult =
  | { readonly outcome: "ran"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly outcome: "not_found"; readonly tried: readonly string[] }
  | { readonly outcome: "failed"; readonly message: string };

let cached: string | null | undefined;

/** Absolute path to `gt`, or null when it is not installed where we can see it. */
export async function resolveGt(): Promise<string | null> {
  if (cached !== undefined) return cached;
  for (const candidate of KNOWN_PATHS) {
    if (existsSync(candidate)) {
      cached = candidate;
      return cached;
    }
  }
  try {
    const { stdout } = await execFileAsync("command", ["-v", "gt"], { shell: "/bin/sh" });
    const found = stdout.trim();
    cached = found.length > 0 ? found : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Runs `gt` with `--no-interactive` appended. A non-zero exit is a result, not a
 * throw: the caller reports it rather than crashing the command.
 */
export async function runGt(
  args: readonly string[],
  options: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<GtResult> {
  const binary = await resolveGt();
  if (binary === null) return { outcome: "not_found", tried: KNOWN_PATHS };

  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args, "--no-interactive"], {
      cwd: options.cwd,
      signal: options.signal,
      timeout: GT_TIMEOUT_MS,
      maxBuffer: GT_MAX_BUFFER,
      encoding: "utf8",
    });
    return { outcome: "ran", exitCode: 0, stdout, stderr };
  } catch (cause) {
    if (cause !== null && typeof cause === "object" && "code" in cause && "stdout" in cause) {
      const code = cause.code;
      const stdout = cause.stdout;
      const stderr = "stderr" in cause ? cause.stderr : "";
      return {
        outcome: "ran",
        exitCode: typeof code === "number" ? code : 1,
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      };
    }
    return { outcome: "failed", message: cause instanceof Error ? cause.message : String(cause) };
  }
}
