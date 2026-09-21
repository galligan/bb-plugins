// Git plumbing for the stack reader.
//
// Only reads. No BB SDK, no `gt`.

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { StackReadError } from "./types.ts";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Where to find git. The BB server's PATH is not the invoking shell's PATH. */
export interface GitOptions {
  readonly repoPath: string;
  readonly gitBinary?: string;
}

async function runGit(options: GitOptions, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(options.gitBinary ?? "git", [...args], {
    cwd: options.repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: "utf8",
  });
  return stdout;
}

/**
 * Absolute path to the common git directory. A worktree's own git directory holds no
 * Graphite metadata; the common directory does.
 */
export async function readGitCommonDir(options: GitOptions): Promise<string> {
  let raw: string;
  try {
    raw = await runGit(options, ["rev-parse", "--git-common-dir"]);
  } catch (cause) {
    throw new StackReadError(
      "not_a_repository",
      `git rev-parse failed in ${options.repoPath}`,
      { cause },
    );
  }
  return resolve(options.repoPath, raw.trim());
}

/** Every local branch and the commit it points at right now. */
export async function readBranchHeads(options: GitOptions): Promise<Map<string, string>> {
  let raw: string;
  try {
    raw = await runGit(options, [
      "for-each-ref",
      "--format=%(objectname) %(refname:lstrip=2)",
      "refs/heads/",
    ]);
  } catch (cause) {
    throw new StackReadError(
      "not_a_repository",
      `git for-each-ref failed in ${options.repoPath}`,
      { cause },
    );
  }

  const heads = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const separator = line.indexOf(" ");
    if (separator === -1) continue;
    const sha = line.slice(0, separator);
    const name = line.slice(separator + 1);
    if (sha.length === 0 || name.length === 0) continue;
    heads.set(name, sha);
  }
  return heads;
}
