// Test support: a throwaway git repository and host environment.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

import {
  createWorktree,
  resolveWorktree,
  type HostEnvironment,
} from "./worktree.ts";

export interface Fixture {
  /** Parent of everything the fixture creates. */
  readonly base: string;
  readonly source: string;
  readonly env: HostEnvironment;
  readonly logs: string[];
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

export async function fixture(
  t: TestContext,
  files: Record<string, string> = {},
): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "bb-wt-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = join(base, "repo");
  await mkdir(source);
  git(source, "init", "--quiet", "--initial-branch=main");
  git(source, "config", "user.email", "test@example.com");
  git(source, "config", "user.name", "Test");
  await writeFile(join(source, "README.md"), "hello\n");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(source, name)), { recursive: true });
    await writeFile(join(source, name), content);
  }
  git(source, "add", "-A");
  git(source, "commit", "--quiet", "-m", "init");
  const logs: string[] = [];
  return {
    base,
    source,
    logs,
    env: {
      root: join(base, "worktrees"),
      dataDir: join(base, "data"),
      report: (kind, text) => logs.push(`${kind}: ${text}`),
      now: () => new Date("2026-01-02T03:04:05Z"),
    },
  };
}

/** Resolves and creates the fixture's one worktree, on branch `bb/task-thr_1`. */
export async function provision(f: Fixture, pathKey = "thr_1-1") {
  const resolved = await resolveWorktree(f.env, {
    pathKey,
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: null,
  });
  assert.equal(resolved.status, "resolved");
  return createWorktree(f.env, { pathKey });
}

/** Like `provision`, but fails the test unless the worktree was created. */
export async function provisioned(f: Fixture): Promise<string> {
  const created = await provision(f);
  assert.equal(created.status, "created");
  return created.status === "created" ? created.path : "";
}
