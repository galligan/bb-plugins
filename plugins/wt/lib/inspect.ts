import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { slug } from "./paths.ts";
import { git } from "./process.ts";
import { listSharedFiles } from "./share.ts";

/**
 * Where a worktree's commits stand. Removal keeps the branch, so none of these
 * make removing the worktree unsafe; they say whether the branch itself is
 * still the only copy of its work.
 *
 * - `no-commits`: nothing committed beyond the base.
 * - `merged`: the base already contains everything the branch changes. This
 *   compares content, not commit ids, so it holds after a squash or rebase.
 * - `pushed`: every commit is on the branch's upstream.
 * - `local`: some commits exist only on this machine.
 * - `detached`: no branch is checked out.
 */
export type BranchState =
  "no-commits" | "merged" | "pushed" | "local" | "detached";

export interface Inspection {
  readonly path: string;
  /** Null when HEAD is detached. */
  readonly branch: string | null;
  /** Tracked files with staged or unstaged changes. */
  readonly changedFiles: number;
  /** Untracked files that are not ignored. */
  readonly untrackedFiles: number;
  /**
   * Ignored files named by `.worktreeinclude` (such as `.env`) that differ from
   * the source checkout's copy. Git status never shows these.
   */
  readonly editedSharedFiles: string[];
  /** An unfinished rebase, merge, cherry-pick, revert or bisect. */
  readonly operation: string | null;
  /** HEAD is detached on commits no branch or remote reaches. */
  readonly unreferencedHead: boolean;
  readonly branchState: BranchState;
  /** Commits on HEAD that no remote has. */
  readonly unpushedCommits: number;
  /** Epoch ms of the newest uncommitted file or, when clean, the last commit. */
  readonly lastActivity: number | null;
  /** True when removing the worktree loses nothing. */
  readonly safeToRemove: boolean;
  /** Why it is not safe, in plain words. Empty when safe. */
  readonly reasons: string[];
}

const OPERATIONS: readonly (readonly [string, string])[] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

async function out(
  path: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await git(path, args, signal);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function count(
  path: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<number> {
  const text = await out(path, ["rev-list", "--count", ...args], signal);
  return text === null ? 0 : Number.parseInt(text, 10) || 0;
}

async function inProgressOperation(
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  for (const [marker, name] of OPERATIONS) {
    const location = await out(
      path,
      ["rev-parse", "--path-format=absolute", "--git-path", marker],
      signal,
    );
    if (location !== null && existsSync(location)) return name;
  }
  return null;
}

/** True when merging HEAD into `base` would leave `base` unchanged. */
async function contentIsIn(
  path: string,
  base: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const merged = await git(
    path,
    ["merge-tree", "--write-tree", base, "HEAD"],
    signal,
  );
  if (merged.code !== 0) return false;
  const mergedTree = merged.stdout.split("\n")[0]?.trim();
  const baseTree = await out(path, ["rev-parse", `${base}^{tree}`], signal);
  return baseTree !== null && mergedTree === baseTree;
}

async function sameContent(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    readFile(a).catch(() => null),
    readFile(b).catch(() => null),
  ]);
  return left !== null && right !== null && left.equals(right);
}

/**
 * Reports what removing a worktree would lose. Read-only: it runs no fetch and
 * changes nothing, so "pushed" and "merged" reflect the remote refs as last
 * fetched.
 */
export async function inspectWorktree(options: {
  path: string;
  sourcePath: string;
  /** Branch the worktree's changes are compared against, when known. */
  mergeBaseBranch: string | null;
  signal?: AbortSignal;
}): Promise<Inspection> {
  const { path, sourcePath, mergeBaseBranch, signal } = options;

  const status = await git(path, ["status", "--porcelain", "-z"], signal);
  if (status.code !== 0) {
    throw new Error(`git status failed in ${path}: ${status.stderr.trim()}`);
  }
  // In -z output a rename entry is followed by its original path as a separate
  // field, which carries no status prefix worth counting.
  const dirtyPaths: string[] = [];
  let changedFiles = 0;
  let untrackedFiles = 0;
  const fields = status.stdout.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    dirtyPaths.push(field.slice(3));
    if (code === "??") untrackedFiles += 1;
    else changedFiles += 1;
    if (code.startsWith("R") || code.startsWith("C")) index += 1;
  }

  const editedSharedFiles: string[] = [];
  const shared = await listSharedFiles({
    repoPath: path,
    sourcePath,
    worktreePath: path,
    signal,
  });
  for (const file of shared) {
    if (!(await sameContent(join(path, file), join(sourcePath, file)))) {
      editedSharedFiles.push(file);
    }
  }

  const branchName = await out(path, ["branch", "--show-current"], signal);
  const branch = branchName === null || branchName === "" ? null : branchName;
  const operation = await inProgressOperation(path, signal);

  let unreferencedHead = false;
  if (branch === null) {
    const reaching = await out(
      path,
      [
        "for-each-ref",
        "--contains",
        "HEAD",
        "--count=1",
        "refs/heads",
        "refs/remotes",
      ],
      signal,
    );
    unreferencedHead = reaching === "";
  }

  let base: string | null = null;
  if (mergeBaseBranch !== null) {
    for (const candidate of [`origin/${mergeBaseBranch}`, mergeBaseBranch]) {
      const exists = await out(
        path,
        ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
        signal,
      );
      if (exists !== null) {
        base = candidate;
        break;
      }
    }
  }

  // Commits that exist only here: on no remote, and not already on the base.
  const unpushedCommits = await count(
    path,
    ["HEAD", "--not", "--remotes", ...(base === null ? [] : [base])],
    signal,
  );

  let branchState: BranchState;
  if (branch === null) {
    branchState = "detached";
  } else if (
    base !== null &&
    (await count(path, [`${base}..HEAD`], signal)) === 0
  ) {
    branchState = "no-commits";
  } else if (base !== null && (await contentIsIn(path, base, signal))) {
    branchState = "merged";
  } else if (
    (await out(
      path,
      ["rev-parse", "--verify", "--quiet", "@{upstream}"],
      signal,
    )) !== null &&
    (await count(path, ["@{upstream}..HEAD"], signal)) === 0
  ) {
    branchState = "pushed";
  } else {
    branchState = unpushedCommits === 0 ? "pushed" : "local";
  }

  let lastActivity: number | null = null;
  for (const file of [...dirtyPaths, ...editedSharedFiles]) {
    const entry = await stat(join(path, file)).catch(() => null);
    if (entry !== null)
      lastActivity = Math.max(lastActivity ?? 0, entry.mtimeMs);
  }
  if (lastActivity === null) {
    const committed = await out(path, ["log", "-1", "--format=%ct"], signal);
    if (committed !== null && committed !== "") {
      lastActivity = Number.parseInt(committed, 10) * 1000;
    }
  }

  const reasons: string[] = [];
  if (changedFiles > 0) {
    reasons.push(
      `${plural(changedFiles, "tracked file")} with uncommitted changes`,
    );
  }
  if (untrackedFiles > 0)
    reasons.push(plural(untrackedFiles, "untracked file"));
  if (editedSharedFiles.length > 0) {
    reasons.push(
      `${plural(editedSharedFiles.length, "ignored file")} edited here (${editedSharedFiles.join(", ")})`,
    );
  }
  if (operation !== null) reasons.push(`a ${operation} is in progress`);
  if (unreferencedHead) {
    reasons.push("HEAD is detached on commits no branch or remote reaches");
  }

  return {
    path,
    branch,
    changedFiles,
    untrackedFiles,
    editedSharedFiles,
    operation,
    unreferencedHead,
    branchState,
    unpushedCommits,
    lastActivity,
    safeToRemove: reasons.length === 0,
    reasons,
  };
}

/**
 * Saves a worktree's uncommitted and untracked files as a commit under
 * `refs/wt-rescue/`, without touching its index, branch or working tree.
 * Ignored files are not included. Returns the ref.
 */
export async function saveRescueSnapshot(options: {
  path: string;
  branch: string | null;
  now: Date;
  signal?: AbortSignal;
}): Promise<string> {
  const { path, signal } = options;
  const scratch = await mkdtemp(join(tmpdir(), "wt-rescue-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    const must = async (args: readonly string[]): Promise<string> => {
      const result = await git(path, args, signal, env);
      if (result.code !== 0) {
        throw new Error(`git ${args[0] ?? ""} failed: ${result.stderr.trim()}`);
      }
      return result.stdout.trim();
    };
    await must(["read-tree", "HEAD"]);
    await must(["add", "--all"]);
    const tree = await must(["write-tree"]);
    const commit = await must([
      "-c",
      "user.name=Worktrees+",
      "-c",
      "user.email=wt@bb.invalid",
      "commit-tree",
      tree,
      "-p",
      "HEAD",
      "-m",
      `Uncommitted work rescued from ${path}`,
    ]);
    const stamp = options.now.toISOString().replace(/\D/gu, "").slice(0, 14);
    const ref = `refs/wt-rescue/${slug(options.branch ?? "detached")}-${stamp}`;
    await must(["update-ref", ref, commit]);
    return ref;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
