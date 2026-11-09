import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
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
import { isUnder, worktreePath } from "./paths.ts";
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
});
type WorktreeRecord = z.infer<typeof recordSchema>;

const recordsDir = (env: HostEnvironment): string =>
  join(env.dataDir, "worktrees");
const recordPath = (env: HostEnvironment, pathKey: string): string =>
  join(recordsDir(env), `${encodeURIComponent(pathKey)}.json`);

async function readRecord(
  env: HostEnvironment,
  pathKey: string,
): Promise<WorktreeRecord | null> {
  const text = await readFile(recordPath(env, pathKey), "utf8").catch(
    () => null,
  );
  return text === null ? null : recordSchema.parse(JSON.parse(text));
}

async function writeRecord(
  env: HostEnvironment,
  record: WorktreeRecord,
): Promise<void> {
  const file = recordPath(env, record.pathKey);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
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
 * Otherwise the remote's default branch, preferring the local branch of that
 * name, then the source checkout's current branch.
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
  if (remoteRef !== "") {
    const name = remoteRef.replace(/^origin\//u, "");
    const baseRef = (await refExists(sourcePath, `refs/heads/${name}`, signal))
      ? name
      : remoteRef;
    return { baseRef, mergeBaseBranch: name };
  }
  const current = await git(sourcePath, ["branch", "--show-current"], signal);
  const branch = current.code === 0 ? current.stdout.trim() : "";
  return branch === ""
    ? failed(
        `No default branch found in ${sourcePath}; choose a base branch explicitly.`,
      )
    : { baseRef: branch, mergeBaseBranch: branch };
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
    });
    return { status: "resolved", path, mergeBaseBranch: base.mergeBaseBranch };
  } catch (error) {
    if (env.signal?.aborted === true) throw error;
    return failed(messageOf(error));
  }
}

export type CreateResult =
  { status: "created"; path: string; mergeBaseBranch: string | null } | Failed;

/** Creates (or resumes) the worktree a prior `resolveWorktree` recorded. */
export async function createWorktree(
  env: HostEnvironment,
  input: { pathKey: string },
): Promise<CreateResult> {
  try {
    const record = await readRecord(env, input.pathKey);
    if (record === null) {
      return failed(`No worktree was resolved for ${input.pathKey}.`);
    }
    const { sourcePath, path, branchName, baseRef } = record;

    if (!(await isRegisteredWorktree(sourcePath, path, env.signal))) {
      env.report("step", `Creating worktree at ${path}`);
      await mkdir(dirname(path), { recursive: true });
      // --no-track: the task branch gets no upstream until it is pushed.
      const added = await git(
        sourcePath,
        ["worktree", "add", "--no-track", "-B", branchName, path, baseRef],
        env.signal,
      );
      if (added.code !== 0) {
        return failed(`git worktree add failed: ${added.stderr.trim()}`);
      }
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

    const plan = await readSetupPlan(path);
    if (plan.source === "codex" && plan.setup !== null) {
      env.report("step", `Running setup from ${CODEX_ENVIRONMENT}`);
      const ran = await runRepoScript(env, path, plan.setup);
      if (!ran.ok) return failed(`Setup script failed: ${ran.reason}.`);
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
 * Removes a launch's worktree and its record, keeping the branch. Uncommitted
 * and untracked files are first saved as a commit under `refs/wt-rescue/`, so
 * removal never discards them; if that save fails, the worktree is kept.
 */
export async function removeWorktree(
  env: HostEnvironment,
  input: { pathKey: string; path: string | null },
): Promise<RemoveResult> {
  try {
    const record = await readRecord(env, input.pathKey);
    const path = record?.path ?? input.path;
    if (path === null) return { status: "removed" };
    if (!isUnder(env.root, path)) {
      return failed(`Refusing to remove ${path}: it is outside ${env.root}.`);
    }

    if (existsSync(path)) {
      const inspection = await inspectWorktree({
        path,
        sourcePath: record?.sourcePath ?? path,
        mergeBaseBranch: record?.mergeBaseBranch ?? null,
        signal: env.signal,
      }).catch(() => null);
      if (
        inspection !== null &&
        (inspection.changedFiles > 0 ||
          inspection.untrackedFiles > 0 ||
          inspection.unreferencedHead)
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
      if (inspection !== null && inspection.editedSharedFiles.length > 0) {
        env.report(
          "log",
          `Not saved (ignored by git): ${inspection.editedSharedFiles.join(", ")}`,
        );
      }

      const plan = await readSetupPlan(path).catch((): SetupPlan => ({
        source: "none",
      }));
      if (plan.source === "codex" && plan.cleanup !== null) {
        env.report("step", `Running cleanup from ${CODEX_ENVIRONMENT}`);
        const ran = await runRepoScript(env, path, plan.cleanup);
        if (!ran.ok) env.report("log", `Cleanup script failed: ${ran.reason}.`);
      }

      env.report("step", `Removing worktree at ${path}`);
      await env.killProcessesUnder?.(path);
      const removed = await git(
        path,
        ["worktree", "remove", "--force", path],
        env.signal,
      ).catch(() => null);
      if (removed === null || removed.code !== 0) {
        await rm(path, { recursive: true, force: true });
      }
    }
    if (record !== null && existsSync(record.sourcePath)) {
      await git(record.sourcePath, ["worktree", "prune"], env.signal);
    }
    await rm(recordPath(env, input.pathKey), { force: true });
    return { status: "removed" };
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
    const record = await readRecord(env, pathKey).catch(() => null);
    if (record === null) continue;
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
