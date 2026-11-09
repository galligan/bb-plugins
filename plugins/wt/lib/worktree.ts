import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  inspectWorktree,
  saveRescueSnapshot,
  type Inspection,
} from "./inspect.ts";
import { isContained, worktreePath } from "./paths.ts";
import { git, runScript } from "./process.ts";
import { repoLocation } from "./remote.ts";
import {
  BB_SETUP_HOOK,
  BB_TEARDOWN_HOOK,
  CODEX_ENVIRONMENT,
  resolveSetupPlan,
  type SetupPlan,
} from "./setup-plan.ts";
import { copySharedFiles } from "./share.ts";

/** Matches the limit bb core applies to its own setup and teardown hooks. */
const SCRIPT_TIMEOUT_MS = 15 * 60 * 1000;

export interface HostEnvironment {
  /** Directory every managed worktree lives under. */
  readonly root: string;
  /** This plugin's persistent directory on the machine. */
  readonly dataDir: string;
  readonly report: (kind: "step" | "log", text: string) => void;
  readonly signal?: AbortSignal;
  /** Stops processes still working inside a directory before it is deleted. */
  readonly killProcessesUnder?: (directory: string) => Promise<unknown>;
  /** Clock for rescue ref names; injectable for tests. */
  readonly now?: () => Date;
}

export interface Failed {
  status: "failed";
  message: string;
}

const failed = (message: string): Failed => ({ status: "failed", message });
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// One record per path key, written before any mutation. It lets `create` resume
// after a restart and lets `remove` clean up when bb only knows the key.
const recordSchema = z.strictObject({
  pathKey: z.string().min(1),
  sourcePath: z.string().min(1),
  path: z.string().min(1),
  branchName: z.string().min(1),
  baseRef: z.string().min(1),
  mergeBaseBranch: z.string().min(1).nullable(),
  // `planned`: a destination was chosen, and nothing at `path` is ours yet.
  // `owned`: this launch created the worktree at `path`, or verified that the
  // worktree there is its own. A granted claim alone is not ownership: bb's
  // claim arbitrates between launches, not what is on disk.
  // `creating`: `git worktree add` was started for `path` and may or may not
  // have left a worktree there (a failing checkout hook exits non-zero after
  // creating it). Cleanup checks what git registered before deciding.
  // Only an owned record, or a creating one whose worktree git registered,
  // authorizes touching `path`.
  state: z.enum(["planned", "creating", "owned"]),
  // `running` on entry means an earlier call was cut off mid-script and the
  // script's outcome is unknown; it is never replayed.
  setup: z.enum(["pending", "running", "done"]),
});
type WorktreeRecord = z.infer<typeof recordSchema>;

const recordsDir = (env: HostEnvironment): string =>
  join(env.dataDir, "worktrees");
const recordPath = (env: HostEnvironment, pathKey: string): string =>
  join(recordsDir(env), `${encodeURIComponent(pathKey)}.json`);

/** The record for a path key, or null when there is none or it is unreadable. */
async function readRecord(
  env: HostEnvironment,
  pathKey: string,
): Promise<WorktreeRecord | null> {
  const text = await readFile(recordPath(env, pathKey), "utf8").catch(
    () => null,
  );
  if (text === null) return null;
  try {
    return recordSchema.parse(JSON.parse(text));
  } catch {
    // A damaged record authorizes nothing. Callers treat it as absent, which
    // lets a launch be cleaned up or re-planned instead of failing forever.
    return null;
  }
}

/** Replaces the record atomically, so a crash never leaves a truncated file. */
async function writeRecord(
  env: HostEnvironment,
  record: WorktreeRecord,
): Promise<void> {
  const file = recordPath(env, record.pathKey);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, file);
}

async function refExists(
  sourcePath: string,
  ref: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await git(
    sourcePath,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    signal,
  );
  return result.code === 0;
}

/**
 * Picks the ref a new branch starts from. An explicit base is used as given.
 * Otherwise the remote's default branch as last fetched (`origin/main`), then
 * the source checkout's current branch.
 */
async function resolveBase(
  sourcePath: string,
  base: string | null,
  signal?: AbortSignal,
): Promise<{ baseRef: string; mergeBaseBranch: string } | Failed> {
  if (base !== null) {
    return (await refExists(sourcePath, base, signal))
      ? { baseRef: base, mergeBaseBranch: base }
      : failed(`Base "${base}" is not a commit in ${sourcePath}.`);
  }
  const remoteHead = await git(
    sourcePath,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    signal,
  );
  const remoteRef = remoteHead.code === 0 ? remoteHead.stdout.trim() : "";
  if (remoteRef !== "" && (await refExists(sourcePath, remoteRef, signal))) {
    // The remote-tracking ref, as bb's own Worktree provider uses: a local
    // default branch is often behind it.
    return { baseRef: remoteRef, mergeBaseBranch: remoteRef };
  }
  const current = await git(sourcePath, ["branch", "--show-current"], signal);
  const branch = current.code === 0 ? current.stdout.trim() : "";
  return branch === ""
    ? failed(
        `No default branch found in ${sourcePath}; choose a base branch explicitly.`,
      )
    : { baseRef: branch, mergeBaseBranch: branch };
}

/**
 * The ref a worktree starts from when no base is chosen, or null when the
 * checkout has none to offer.
 */
export async function defaultBase(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const base = await resolveBase(sourcePath, null, signal);
  return "status" in base ? null : base.baseRef;
}

async function isRegisteredWorktree(
  sourcePath: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!existsSync(path)) return false;
  const listed = await git(
    sourcePath,
    ["worktree", "list", "--porcelain", "-z"],
    signal,
  );
  if (listed.code !== 0) return false;
  const target = await realpath(path);
  for (const field of listed.stdout.split("\0")) {
    if (!field.startsWith("worktree ")) continue;
    const listedPath = field.slice("worktree ".length);
    const resolved = await realpath(listedPath).catch(() => listedPath);
    if (resolved === target) return true;
  }
  return false;
}

/** True when `path` is a worktree of `sourcePath` with `branchName` checked out. */
async function isOwnWorktree(
  record: Pick<WorktreeRecord, "sourcePath" | "path" | "branchName">,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!(await isRegisteredWorktree(record.sourcePath, record.path, signal))) {
    return false;
  }
  const branch = await git(record.path, ["branch", "--show-current"], signal);
  return branch.code === 0 && branch.stdout.trim() === record.branchName;
}

// Written into a worktree's own git directory once it is this launch's. Git
// makes that directory with the worktree and deletes it with the worktree, so
// a replacement at the same path never carries the marker.
const LAUNCH_MARKER = "wt-launch";

async function launchMarkerFile(
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const gitDir = await git(path, ["rev-parse", "--absolute-git-dir"], signal);
  return gitDir.code === 0 ? join(gitDir.stdout.trim(), LAUNCH_MARKER) : null;
}

async function markAsLaunch(
  record: Pick<WorktreeRecord, "pathKey" | "path">,
  signal?: AbortSignal,
): Promise<void> {
  const file = await launchMarkerFile(record.path, signal);
  if (file === null) {
    throw new Error(`${record.path} has no git directory to mark.`);
  }
  await writeFile(file, `${record.pathKey}\n`);
}

/**
 * True when whatever is at `path` is the worktree the launch `pathKey` made.
 * The branch is not the test: work in a worktree moves between branches.
 */
async function isLaunchWorktree(
  pathKey: string,
  path: string,
  record: WorktreeRecord | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const file = await launchMarkerFile(path, signal);
  const marker =
    file === null ? null : await readFile(file, "utf8").catch(() => null);
  if (marker !== null) return marker.trim() === pathKey;
  // No marker: a worktree from before markers existed, or one whose create was
  // cut off before the marker was written. Its record has to vouch for it.
  return record !== null && (await isOwnWorktree(record, signal));
}

async function readSetupPlan(path: string): Promise<SetupPlan> {
  return resolveSetupPlan({
    hasBbHook:
      existsSync(join(path, BB_SETUP_HOOK)) ||
      existsSync(join(path, BB_TEARDOWN_HOOK)),
    codexEnvironmentToml: await readFile(
      join(path, CODEX_ENVIRONMENT),
      "utf8",
    ).catch(() => null),
  });
}

function runRepoScript(env: HostEnvironment, path: string, script: string) {
  return runScript({
    script,
    cwd: path,
    // Codex setup scripts resolve their checkout from this variable.
    env: { ...process.env, CODEX_WORKTREE_PATH: path },
    timeoutMs: SCRIPT_TIMEOUT_MS,
    signal: env.signal,
    onOutput: (line) => env.report("log", line),
  });
}

export interface ResolveInput {
  pathKey: string;
  sourcePath: string;
  branchName: string;
  base: string | null;
}

export type ResolveResult =
  { status: "resolved"; path: string; mergeBaseBranch: string | null } | Failed;

/**
 * Decides where a launch's worktree goes and records it, without touching the
 * repository. The server claims the returned path before calling `create`.
 */
export async function resolveWorktree(
  env: HostEnvironment,
  input: ResolveInput,
): Promise<ResolveResult> {
  try {
    const existing = await readRecord(env, input.pathKey);
    if (existing !== null) {
      return {
        status: "resolved",
        path: existing.path,
        mergeBaseBranch: existing.mergeBaseBranch,
      };
    }
    const base = await resolveBase(input.sourcePath, input.base, env.signal);
    if ("status" in base) return base;

    // Key the folder on the repository's remote, not on a bb project name, so
    // renaming the project or moving the checkout never relocates worktrees.
    const origin = await git(
      input.sourcePath,
      ["remote", "get-url", "origin"],
      env.signal,
    );
    const location = repoLocation(
      origin.code === 0 ? origin.stdout.trim() : null,
      input.sourcePath,
    );
    const path = worktreePath(env.root, location, input.branchName);
    if (!(await isContained(env.root, path))) {
      return failed(
        `${path} resolves outside ${env.root}; a folder on the way is a symlink.`,
      );
    }
    if (existsSync(path)) {
      return failed(`${path} already exists and belongs to another launch.`);
    }
    await writeRecord(env, {
      pathKey: input.pathKey,
      sourcePath: input.sourcePath,
      path,
      branchName: input.branchName,
      baseRef: base.baseRef,
      mergeBaseBranch: base.mergeBaseBranch,
      state: "planned",
      setup: "pending",
    });
    return { status: "resolved", path, mergeBaseBranch: base.mergeBaseBranch };
  } catch (error) {
    if (env.signal?.aborted === true) throw error;
    return failed(messageOf(error));
  }
}

export type CreateResult =
  { status: "created"; path: string; mergeBaseBranch: string | null } | Failed;

/**
 * Creates (or resumes) the worktree a prior `resolveWorktree` recorded. Call it
 * only after bb has granted this launch the path. The record becomes `owned`
 * once the worktree exists and is this launch's, never before.
 *
 * Safe to call again for the same path key. An existing worktree is kept, shared
 * files already present are not replaced, and a setup script that finished is
 * not run again.
 */
export async function createWorktree(
  env: HostEnvironment,
  input: { pathKey: string },
): Promise<CreateResult> {
  try {
    let record = await readRecord(env, input.pathKey);
    if (record === null) {
      return failed(`No worktree was resolved for ${input.pathKey}.`);
    }
    const { sourcePath, path, branchName, baseRef } = record;
    // The plan may be old (a restart can sit between resolve and create), so
    // check again where it really points before touching the filesystem.
    if (!(await isContained(env.root, path))) {
      return failed(
        `${path} resolves outside ${env.root}; a folder on the way is a symlink.`,
      );
    }

    if (record.state !== "owned") {
      if (existsSync(path)) {
        if (!(await isOwnWorktree(record, env.signal))) {
          return failed(`${path} exists but is not this launch's worktree.`);
        }
      } else {
        env.report("step", `Creating worktree at ${path}`);
        record = { ...record, state: "creating" };
        await writeRecord(env, record);
        await mkdir(dirname(path), { recursive: true });
        // Never reset a branch that already exists: removal keeps branches, so
        // it may hold commits from an earlier attempt. Check it out as it is.
        const reuse = await refExists(
          sourcePath,
          `refs/heads/${branchName}`,
          env.signal,
        );
        if (reuse) {
          env.report("log", `Branch ${branchName} already exists; reusing it.`);
        }
        const added = await git(
          sourcePath,
          reuse
            ? ["worktree", "add", path, branchName]
            : // --no-track: the branch gets no upstream until it is pushed.
              [
                "worktree",
                "add",
                "--no-track",
                "-b",
                branchName,
                path,
                baseRef,
              ],
          env.signal,
        );
        if (added.code !== 0) {
          return failed(`git worktree add failed: ${added.stderr.trim()}`);
        }
      }
      await markAsLaunch(record, env.signal);
      record = { ...record, state: "owned" };
      await writeRecord(env, record);
    } else if (!(await isRegisteredWorktree(sourcePath, path, env.signal))) {
      return failed(`${path} is no longer a worktree of ${sourcePath}.`);
    }

    const copied = await copySharedFiles({
      sourcePath,
      targetPath: path,
      signal: env.signal,
    });
    if (copied.length > 0) {
      env.report("step", `Copied ${String(copied.length)} shared file(s)`);
      for (const file of copied) env.report("log", file);
    }

    if (record.setup === "running") {
      return failed(
        "Setup was interrupted and its outcome is unknown. Retry the launch to rebuild the worktree.",
      );
    }
    if (record.setup === "pending") {
      const plan = await readSetupPlan(path);
      if (plan.source === "codex" && plan.setup !== null) {
        await writeRecord(env, { ...record, setup: "running" });
        env.report("step", `Running setup from ${CODEX_ENVIRONMENT}`);
        const ran = await runRepoScript(env, path, plan.setup);
        if (!ran.ok) return failed(`Setup script failed: ${ran.reason}.`);
      }
      await writeRecord(env, { ...record, setup: "done" });
    }

    return {
      status: "created",
      path,
      mergeBaseBranch: record.mergeBaseBranch,
    };
  } catch (error) {
    if (env.signal?.aborted === true) throw error;
    return failed(messageOf(error));
  }
}

export type RemoveResult = { status: "removed" } | Failed;

/**
 * Removes a launch's worktree and its record, keeping the branch.
 *
 * It fails closed. Nothing is deleted unless the folder is inside the managed
 * root, is still the worktree this launch made, can be inspected, has no git
 * operation in progress, and every uncommitted change was saved to
 * `refs/wt-rescue/` first. Only `git worktree remove` deletes the folder; if
 * git refuses, the worktree is left in place.
 */
export async function removeWorktree(
  env: HostEnvironment,
  input: { pathKey: string; path: string | null },
): Promise<RemoveResult> {
  try {
    const record = await readRecord(env, input.pathKey);
    const forget = async (): Promise<RemoveResult> => {
      await rm(recordPath(env, input.pathKey), { force: true });
      return { status: "removed" };
    };
    // A planned record never got the path: whatever is there is someone else's.
    if (record !== null && record.state === "planned") return forget();
    // An interrupted or failed create is ours only if git registered it.
    if (
      record !== null &&
      record.state === "creating" &&
      !(await isRegisteredWorktree(record.sourcePath, record.path, env.signal))
    ) {
      return forget();
    }
    const path = record?.path ?? input.path;
    if (path === null) return forget();
    if (!(await isContained(env.root, path))) {
      return failed(`Refusing to remove ${path}: it is outside ${env.root}.`);
    }
    const sourcePath = record?.sourcePath ?? path;

    if (existsSync(path)) {
      // The path can outlive the worktree: removed by hand, then reused.
      if (!(await isLaunchWorktree(input.pathKey, path, record, env.signal))) {
        return failed(
          `Not removing ${path}: it could not be confirmed as the worktree this launch created. If it should go, run "git worktree remove" on it (or delete the folder if it is not a worktree), then delete again.`,
        );
      }
      // Cleanup and running processes can still write files, so both finish
      // before the worktree is inspected and saved.
      const plan = await readSetupPlan(path).catch((error: unknown) => {
        env.report(
          "log",
          `Skipping cleanup: ${CODEX_ENVIRONMENT} could not be read (${messageOf(error)}).`,
        );
        return null;
      });
      if (plan?.source === "codex" && plan.cleanup !== null) {
        env.report("step", `Running cleanup from ${CODEX_ENVIRONMENT}`);
        const ran = await runRepoScript(env, path, plan.cleanup);
        if (!ran.ok) {
          env.report("log", `Cleanup script failed: ${ran.reason}.`);
        }
      }
      await env.killProcessesUnder?.(path);

      const inspection = await inspectWorktree({
        path,
        sourcePath,
        mergeBaseBranch: record?.mergeBaseBranch ?? null,
        signal: env.signal,
      });
      if (inspection.conflictedFiles > 0) {
        return failed(
          `Not removing ${path}: ${String(inspection.conflictedFiles)} file(s) have unresolved conflicts, which cannot be saved faithfully. Resolve or abort the ${inspection.operation ?? "merge"} there, then delete again.`,
        );
      }
      if (inspection.operation !== null) {
        return failed(
          `Not removing ${path}: a ${inspection.operation} is in progress, and its remaining steps cannot be saved. Finish or abort it there, then delete again.`,
        );
      }
      if (inspection.unsavedSubmodules.length > 0) {
        return failed(
          `Not removing ${path}: submodule work cannot be saved automatically (${inspection.unsavedSubmodules.join(", ")}). Commit and push it there, then delete again.`,
        );
      }
      if (
        inspection.changedFiles > 0 ||
        inspection.untrackedFiles > 0 ||
        inspection.unreferencedHead
      ) {
        const ref = await saveRescueSnapshot({
          path,
          branch: inspection.branch,
          now: env.now?.() ?? new Date(),
          signal: env.signal,
        });
        env.report("step", `Saved uncommitted work to ${ref}`);
        env.report("log", `Restore it with: git checkout ${ref} -- .`);
      }
      if (inspection.editedSharedFiles.length > 0) {
        env.report(
          "log",
          `Not saved (ignored by git): ${inspection.editedSharedFiles.join(", ")}`,
        );
      }

      env.report("step", `Removing worktree at ${path}`);
      const removed = await git(
        path,
        ["worktree", "remove", "--force", path],
        env.signal,
      );
      if (removed.code !== 0) {
        return failed(
          `git worktree remove failed, so ${path} was left in place: ${removed.stderr.trim()}`,
        );
      }
    }
    if (record !== null && existsSync(record.sourcePath)) {
      await git(record.sourcePath, ["worktree", "prune"], env.signal);
    }
    return await forget();
  } catch (error) {
    if (env.signal?.aborted === true) throw error;
    return failed(messageOf(error));
  }
}

export type ListedWorktree =
  | { status: "present"; pathKey: string; inspection: Inspection }
  | { status: "missing"; pathKey: string; path: string }
  | { status: "unreadable"; pathKey: string; path: string; message: string };

/** Every worktree this plugin has recorded on the machine, with what removing it would lose. */
export async function listWorktrees(
  env: HostEnvironment,
): Promise<ListedWorktree[]> {
  const files = await readdir(recordsDir(env)).catch((): string[] => []);
  const listed: ListedWorktree[] = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const pathKey = decodeURIComponent(file.slice(0, -".json".length));
    const record = await readRecord(env, pathKey);
    if (record === null) {
      listed.push({
        status: "unreadable",
        pathKey,
        path: recordPath(env, pathKey),
        message:
          "This record file is damaged, so the worktree it described is unknown.",
      });
      continue;
    }
    if (!existsSync(record.path)) {
      listed.push({ status: "missing", pathKey, path: record.path });
      continue;
    }
    try {
      listed.push({
        status: "present",
        pathKey,
        inspection: await inspectWorktree({
          path: record.path,
          sourcePath: record.sourcePath,
          mergeBaseBranch: record.mergeBaseBranch,
          signal: env.signal,
        }),
      });
    } catch (error) {
      if (env.signal?.aborted === true) throw error;
      listed.push({
        status: "unreadable",
        pathKey,
        path: record.path,
        message: messageOf(error),
      });
    }
  }
  return listed;
}
