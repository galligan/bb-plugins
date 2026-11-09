import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { fixture, git, provisioned, type Fixture } from "./fixture.ts";
import { inspectWorktree } from "./inspect.ts";

const inspect = (f: Fixture, path: string) =>
  inspectWorktree({ path, sourcePath: f.source, mergeBaseBranch: "main" });

async function commit(path: string, file: string, content: string) {
  await writeFile(join(path, file), content);
  git(path, "add", "-A");
  git(path, "commit", "--quiet", "-m", `add ${file}`);
}

test("a fresh worktree is safe and has no commits", async (t) => {
  const f = await fixture(t);
  const report = await inspect(f, await provisioned(f));
  assert.equal(report.safeToRemove, true);
  assert.deepEqual(report.reasons, []);
  assert.equal(report.branch, "bb/task-thr_1");
  assert.equal(report.branchState, "no-commits");
});

test("uncommitted and untracked files make it unsafe, with counts", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "README.md"), "edited\n");
  await writeFile(join(path, "a.txt"), "a\n");
  await writeFile(join(path, "b.txt"), "b\n");

  const report = await inspect(f, path);
  assert.equal(report.safeToRemove, false);
  assert.equal(report.changedFiles, 1);
  assert.equal(report.untrackedFiles, 2);
  assert.deepEqual(report.reasons, [
    "1 tracked file with uncommitted changes",
    "2 untracked files",
  ]);
  assert.ok(
    report.lastActivity !== null && report.lastActivity > Date.now() - 60_000,
  );
});

test("committed work is safe to remove but the branch is local only", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await commit(path, "feature.txt", "x\n");

  const report = await inspect(f, path);
  assert.equal(report.safeToRemove, true);
  assert.equal(report.branchState, "local");
  assert.equal(report.unpushedCommits, 1);
});

test("a squash-merged branch reads as merged even though no commit ids match", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await commit(path, "feature.txt", "x\n");
  await commit(path, "more.txt", "y\n");
  git(f.source, "merge", "--squash", "--quiet", "bb/task-thr_1");
  git(f.source, "commit", "--quiet", "-m", "squashed");

  const report = await inspect(f, path);
  assert.equal(report.branchState, "merged");
});

test("a pushed branch reads as pushed", async (t) => {
  const f = await fixture(t);
  const remote = join(f.base, "remote.git");
  git(f.base, "init", "--quiet", "--bare", remote);
  git(f.source, "remote", "add", "origin", remote);
  git(f.source, "push", "--quiet", "origin", "main");
  const path = await provisioned(f);
  await commit(path, "feature.txt", "x\n");
  git(path, "push", "--quiet", "-u", "origin", "HEAD");

  const report = await inspect(f, path);
  assert.equal(report.branchState, "pushed");
  assert.equal(report.unpushedCommits, 0);
});

test("an edited ignored file from .worktreeinclude is caught", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env\n",
    ".worktreeinclude": ".env\n",
  });
  await writeFile(join(f.source, ".env"), "TOKEN=1\n");
  const path = await provisioned(f);
  assert.equal((await inspect(f, path)).safeToRemove, true);

  await writeFile(join(path, ".env"), "TOKEN=2\n");
  const report = await inspect(f, path);
  assert.equal(report.safeToRemove, false);
  assert.deepEqual(report.editedSharedFiles, [".env"]);
});

test("a detached HEAD on unreferenced commits is unsafe", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  git(path, "checkout", "--quiet", "--detach");
  await commit(path, "orphan.txt", "x\n");

  const report = await inspect(f, path);
  assert.equal(report.branchState, "detached");
  assert.equal(report.unreferencedHead, true);
  assert.equal(report.safeToRemove, false);
});

test("an unfinished merge is reported", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await commit(path, "README.md", "theirs\n");
  await writeFile(join(f.source, "README.md"), "ours\n");
  git(f.source, "commit", "--quiet", "-am", "ours");
  try {
    git(path, "merge", "--quiet", "main");
  } catch {
    // The conflict is the point.
  }
  const report = await inspect(f, path);
  assert.equal(report.operation, "merge");
  assert.equal(report.safeToRemove, false);
});
