import { constants } from "node:fs";
import { copyFile, lstat, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isContained } from "./paths.ts";
import { git } from "./process.ts";

export const WORKTREE_INCLUDE = ".worktreeinclude";

async function isRegularFile(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => null);
  return entry !== null && entry.isFile();
}

/**
 * Lists the untracked regular files in `repoPath` that match the
 * `.worktreeinclude` patterns (gitignore syntax), as repo-relative paths. The
 * pattern file is the worktree's committed copy when there is one, otherwise
 * the source checkout's, so a local, uncommitted list still works.
 */
export async function listSharedFiles(options: {
  repoPath: string;
  sourcePath: string;
  worktreePath: string;
  signal?: AbortSignal;
}): Promise<readonly string[]> {
  let patternFile: string | null = null;
  for (const root of [options.worktreePath, options.sourcePath]) {
    const candidate = join(root, WORKTREE_INCLUDE);
    if (await isRegularFile(candidate)) {
      patternFile = candidate;
      break;
    }
  }
  if (patternFile === null) return [];

  const listed = await git(
    options.repoPath,
    [
      "ls-files",
      "--others",
      "--ignored",
      `--exclude-from=${patternFile}`,
      "-z",
    ],
    options.signal,
  );
  if (listed.code !== 0) {
    throw new Error(
      `Could not list ${WORKTREE_INCLUDE} matches: ${listed.stderr.trim()}`,
    );
  }
  const files: string[] = [];
  for (const relativePath of listed.stdout.split("\0")) {
    if (relativePath === "" || relativePath.endsWith("/")) continue;
    if (await isRegularFile(join(options.repoPath, relativePath))) {
      files.push(relativePath);
    }
  }
  return files;
}

/**
 * Copies the source checkout's shared files into a new worktree. Regular files
 * only, no symlinks, nothing the worktree already has is replaced, and nothing
 * is written through a symlink that leads out of the worktree. Returns the
 * copied paths.
 */
export async function copySharedFiles(options: {
  sourcePath: string;
  targetPath: string;
  signal?: AbortSignal;
}): Promise<readonly string[]> {
  const { sourcePath, targetPath, signal } = options;
  const shared = await listSharedFiles({
    repoPath: sourcePath,
    sourcePath,
    worktreePath: targetPath,
    signal,
  });

  const copied: string[] = [];
  for (const relativePath of shared) {
    const from = join(sourcePath, relativePath);
    const to = join(targetPath, relativePath);
    // A tracked symlink in the worktree can stand where the source checkout
    // has a real folder. Following it would write outside the worktree.
    if (!(await isContained(targetPath, to))) continue;
    await mkdir(dirname(to), { recursive: true });
    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      copied.push(relativePath);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
  }
  return copied;
}
