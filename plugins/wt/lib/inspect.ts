import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative as relativePath } from "node:path";

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
  /**
   * Files with unresolved merge conflicts. Their index entries cannot be
   * written as a tree, so they cannot be saved faithfully.
   */
  readonly conflictedFiles: number;
  /** An unfinished rebase, merge, cherry-pick, revert or bisect. */
  readonly operation: string | null;
  /** HEAD is detached on commits no branch or remote reaches. */
  readonly unreferencedHead: boolean;
  /**
   * Initialized submodules with uncommitted changes or commits on no remote.
   * A submodule's own repository lives inside the worktree's git data, so
   * removal would delete this work and a rescue snapshot cannot hold it.
   */
  readonly unsavedSubmodules: string[];
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

/**
 * True when merging HEAD into `base` would leave `base` unchanged. The merge
 * is computed into a throwaway object directory, so the repository gains no
 * objects.
 */
async function contentIsIn(
  path: string,
  base: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const objects = await out(
    path,
    ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
    signal,
  );
  const baseTree = await out(path, ["rev-parse", `${base}^{tree}`], signal);
  if (objects === null || baseTree === null) return false;
  const scratch = await mkdtemp(join(tmpdir(), "wt-merge-"));
  try {
    const merged = await git(
      path,
      ["merge-tree", "--write-tree", base, "HEAD"],
      signal,
      {
        GIT_OBJECT_DIRECTORY: scratch,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: objects,
      },
    );
    return (
      merged.code === 0 && merged.stdout.split("\n")[0]?.trim() === baseTree
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Every git repository under a `modules` directory, at any depth. */
async function moduleRepositories(directory: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = join(directory, entry.name);
    if (existsSync(join(child, "HEAD"))) {
      found.push(child, ...(await moduleRepositories(join(child, "modules"))));
    } else {
      found.push(...(await moduleRepositories(child)));
    }
  }
  return found;
}

/**
 * Initialized submodules, at any depth, with uncommitted changes or commits on
 * no remote. They are found from the index's gitlink entries, not from
 * `.gitmodules`, which is only a working-tree file and may be missing or
 * edited. A submodule removed from the index is reported too when the
 * repository git kept for it holds commits that are on no remote.
 */
async function submodulesWithUnsavedWork(
  path: string,
  signal?: AbortSignal,
  prefix = "",
): Promise<string[]> {
  const staged = await git(
    path,
    ["--no-optional-locks", "ls-files", "--stage", "-z"],
    signal,
  );
  if (staged.code !== 0) {
    throw new Error(`Could not list submodules: ${staged.stderr.trim()}`);
  }
  const unsaved: string[] = [];
  // Git directories of the submodules that are accounted for by a gitlink.
  const accounted = new Set<string>();
  for (const entry of staged.stdout.split("\0")) {
    if (!entry.startsWith("160000 ")) continue;
    const relative = entry.slice(entry.indexOf("\t") + 1);
    const directory = join(path, relative);
    if (!existsSync(join(directory, ".git"))) continue;
    const gitDir = await out(
      directory,
      ["rev-parse", "--absolute-git-dir"],
      signal,
    );
    if (gitDir === null) {
      throw new Error(`Could not inspect submodule ${prefix}${relative}.`);
    }
    accounted.add(await realpath(gitDir));
    const status = await git(
      directory,
      ["--no-optional-locks", "status", "--porcelain"],
      signal,
    );
    if (status.code !== 0) {
      throw new Error(
        `Could not inspect submodule ${prefix}${relative}: ${status.stderr.trim()}`,
      );
    }
    const offRemote = await count(
      directory,
      ["HEAD", "--not", "--remotes"],
      signal,
    );
    if (status.stdout.trim() !== "" || offRemote > 0) {
      unsaved.push(`${prefix}${relative}`);
    }
    unsaved.push(
      ...(await submodulesWithUnsavedWork(
        directory,
        signal,
        `${prefix}${relative}/`,
      )),
    );
  }
  // A submodule removed from the index keeps its repository in this worktree's
  // git data, commits included. Any such repository holding commits that are on
  // no remote would be deleted with the worktree.
  const modules = await out(
    path,
    ["rev-parse", "--path-format=absolute", "--git-path", "modules"],
    signal,
  );
  for (const repository of modules === null
    ? []
    : await moduleRepositories(modules)) {
    if (accounted.has(await realpath(repository))) continue;
    const local = await git(
      path,
      [
        "--git-dir",
        repository,
        "rev-list",
        "-n",
        "1",
        "--all",
        "HEAD",
        "--not",
        "--remotes",
      ],
      signal,
    );
    // Fail closed: a repository that cannot be read counts as unsaved.
    if (local.code !== 0 || local.stdout.trim() !== "") {
      unsaved.push(
        `${prefix}(removed submodule ${relativePath(modules ?? "", repository)})`,
      );
    }
  }
  return unsaved;
}

async function sameContent(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    readFile(a).catch(() => null),
    readFile(b).catch(() => null),
  ]);
  return left !== null && right !== null && left.equals(right);
}

/** The subset of `files` (relative to `path`) that git ignores. */
async function ignoredAmong(
  path: string,
  files: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const ignored: string[] = [];
  for (const file of files) {
    // One path per call: exit 0 is ignored, 1 is not, anything else failed.
    const checked = await git(path, ["check-ignore", "-q", "--", file], signal);
    if (checked.code === 0) ignored.push(file);
    else if (checked.code !== 1) {
      throw new Error(
        `git check-ignore failed in ${path}: ${checked.stderr.trim()}`,
      );
    }
  }
  return ignored;
}

/** SHA-256 of a file's content, or null when it cannot be read. */
export async function contentHash(path: string): Promise<string | null> {
  const content = await readFile(path).catch(() => null);
  return content === null
    ? null
    : createHash("sha256").update(content).digest("hex");
}

/**
 * Reports what removing a worktree would lose. Read-only: it runs no fetch and
 * writes nothing to the repository, so "pushed" and "merged" reflect the remote refs as last
 * fetched.
 */
export async function inspectWorktree(options: {
  path: string;
  sourcePath: string;
  /** Branch the worktree's changes are compared against, when known. */
  mergeBaseBranch: string | null;
  /**
   * Content hash of each shared file as it was copied in, by relative path.
   * Without one, a file counts as edited whenever it differs from the source
   * checkout's copy, including when only the source changed.
   */
  copiedSharedFiles?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}): Promise<Inspection> {
  const { path, sourcePath, mergeBaseBranch, signal } = options;
  const copiedSharedFiles = options.copiedSharedFiles ?? {};

  // --no-optional-locks: do not refresh the index file while only reading.
  const status = await git(
    path,
    ["--no-optional-locks", "status", "--porcelain", "-z"],
    signal,
  );
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

  const unmerged = await git(
    path,
    ["--no-optional-locks", "ls-files", "--unmerged", "-z"],
    signal,
  );
  if (unmerged.code !== 0) {
    throw new Error(
      `git ls-files failed in ${path}: ${unmerged.stderr.trim()}`,
    );
  }
  const conflictedFiles = new Set(
    unmerged.stdout
      .split("\0")
      .filter((entry) => entry !== "")
      .map((entry) => entry.slice(entry.indexOf("\t") + 1)),
  ).size;

  const editedSharedFiles: string[] = [];
  const shared = await listSharedFiles({
    repoPath: path,
    sourcePath,
    worktreePath: path,
    signal,
  });
  // A shared file git does not ignore is an ordinary untracked file: status
  // counts it and the rescue snapshot saves it.
  for (const file of await ignoredAmong(path, shared, signal)) {
    // Unedited means the content also exists elsewhere, or never changed
    // since it was copied (the source checkout may have moved on since).
    const copiedHash = copiedSharedFiles[file];
    const unedited =
      (await sameContent(join(path, file), join(sourcePath, file))) ||
      (copiedHash !== undefined &&
        (await contentHash(join(path, file))) === copiedHash);
    if (!unedited) editedSharedFiles.push(file);
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

  // "Pushed" means every commit is on some remote. An upstream is not enough:
  // git lets a branch track another local branch.
  const offRemote = await count(path, ["HEAD", "--not", "--remotes"], signal);

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
  } else {
    branchState = offRemote === 0 ? "pushed" : "local";
  }

  const unsavedSubmodules = await submodulesWithUnsavedWork(path, signal);

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
  if (conflictedFiles > 0) {
    reasons.push(
      `${plural(conflictedFiles, "file")} with unresolved conflicts`,
    );
  }
  if (operation !== null) reasons.push(`a ${operation} is in progress`);
  if (unreferencedHead) {
    reasons.push("HEAD is detached on commits no branch or remote reaches");
  }
  if (unsavedSubmodules.length > 0) {
    reasons.push(
      `${plural(unsavedSubmodules.length, "submodule")} with unsaved work (${unsavedSubmodules.join(", ")})`,
    );
  }

  return {
    path,
    branch,
    changedFiles,
    untrackedFiles,
    editedSharedFiles,
    conflictedFiles,
    operation,
    unreferencedHead,
    unsavedSubmodules,
    branchState,
    unpushedCommits,
    lastActivity,
    safeToRemove: reasons.length === 0,
    reasons,
  };
}

const RESCUE_IDENTITY = [
  "-c",
  "user.name=Worktree+",
  "-c",
  "user.email=wt@bb.invalid",
] as const;

/**
 * Saves a worktree's uncommitted state as a commit under `refs/wt-rescue/`,
 * without touching its index, branch or working tree. Returns the ref.
 *
 * The commit's tree is the working tree: tracked changes plus untracked files.
 * Its first parent is HEAD. When anything is staged, a second parent holds the
 * index, as `git stash` does, so a staged version that differs from the file
 * on disk survives too. An index with unresolved conflicts cannot be written
 * as a tree, so this throws for one; `conflictedFiles` reports that up front.
 *
 * Ignored files are never included: they are where secrets live, and a
 * snapshot is a git object that can be pushed. Submodule contents are not
 * included either. The ref name is unique per snapshot and an existing ref is
 * never overwritten.
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
    const must = async (
      args: readonly string[],
      env: NodeJS.ProcessEnv = {},
    ): Promise<string> => {
      const result = await git(path, args, signal, env);
      if (result.code !== 0) {
        throw new Error(
          `git ${args.find((arg) => !arg.startsWith("-") && !arg.includes("=")) ?? ""} failed: ${result.stderr.trim()}`,
        );
      }
      return result.stdout.trim();
    };
    const commitTree = (tree: string, parents: string[], message: string) =>
      must([
        ...RESCUE_IDENTITY,
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        message,
      ]);

    const parents = ["HEAD"];
    const staged = await git(path, ["diff", "--cached", "--quiet"], signal);
    if (staged.code !== 0) {
      // Fails when the index has unresolved conflicts. Callers must refuse to
      // remove such a worktree: there is no faithful way to save that index.
      const indexTree = await must(["write-tree"]);
      parents.push(
        await commitTree(indexTree, ["HEAD"], `Index rescued from ${path}`),
      );
    }

    const env = { GIT_INDEX_FILE: join(scratch, "worktree") };
    await must(["read-tree", "HEAD"], env);
    await must(["add", "--all"], env);
    const commit = await commitTree(
      await must(["write-tree"], env),
      parents,
      `Uncommitted work rescued from ${path}`,
    );

    const stamp = options.now.toISOString().replace(/\D/gu, "").slice(0, 14);
    const ref = `refs/wt-rescue/${slug(options.branch ?? "detached")}-${stamp}-${commit.slice(0, 10)}`;
    // An empty old value makes this create-only: it never replaces a rescue.
    const created = await git(path, ["update-ref", ref, commit, ""], signal);
    if (created.code !== 0) {
      const existing = await out(path, ["rev-parse", "--verify", ref], signal);
      if (existing !== commit) {
        throw new Error(`Could not create ${ref}: ${created.stderr.trim()}`);
      }
    }
    return ref;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
