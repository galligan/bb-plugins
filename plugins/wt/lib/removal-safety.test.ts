// Regression tests for the ways removal or re-creation could lose work.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { fixture, git, provision, provisioned } from "./fixture.ts";
import { saveRescueSnapshot } from "./inspect.ts";
import { createWorktree, removeWorktree, resolveWorktree } from "./worktree.ts";

const KEY = "thr_1-1";
const rescueRefs = (repo: string): string[] =>
  git(repo, "for-each-ref", "--format=%(refname)", "refs/wt-rescue")
    .split("\n")
    .filter((line) => line !== "");

test("a worktree that cannot be inspected is left alone", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "precious.txt"), "only copy\n");
  await writeFile(join(path, ".git"), "gitdir: /nonexistent\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.equal(
    await readFile(join(path, "precious.txt"), "utf8"),
    "only copy\n",
  );
});

test("a symlinked folder cannot redirect removal outside the root", async (t) => {
  const f = await fixture(t);
  const outside = join(f.base, "outside");
  await mkdir(join(outside, "victim"), { recursive: true });
  await writeFile(join(outside, "victim", "keep.txt"), "keep\n");
  await mkdir(f.env.root, { recursive: true });
  await symlink(outside, join(f.env.root, "alias"));

  const removed = await removeWorktree(f.env, {
    pathKey: "unknown",
    path: join(f.env.root, "alias", "victim"),
  });
  assert.equal(removed.status, "failed");
  assert.equal(existsSync(join(outside, "victim", "keep.txt")), true);
});

test("a symlinked folder cannot redirect creation outside the root", async (t) => {
  const f = await fixture(t);
  const outside = join(f.base, "outside");
  await mkdir(outside);
  await mkdir(f.env.root, { recursive: true });
  await symlink(outside, join(f.env.root, "_local"));

  const resolved = await resolveWorktree(f.env, {
    pathKey: KEY,
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: null,
  });
  assert.equal(resolved.status, "failed");
});

test("a staged version that differs from the file on disk is saved", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "README.md"), "staged only\n");
  git(path, "add", "README.md");
  await writeFile(join(path, "README.md"), "hello\n");

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  const [ref] = rescueRefs(f.source);
  assert.equal(git(f.source, "show", `${ref}:README.md`), "hello");
  assert.equal(git(f.source, "show", `${ref}^2:README.md`), "staged only");
});

test("an index with unresolved conflicts is saved as a raw file", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "README.md"), "theirs\n");
  git(path, "commit", "--quiet", "-am", "theirs");
  await writeFile(join(f.source, "README.md"), "ours\n");
  git(f.source, "commit", "--quiet", "-am", "ours");
  try {
    git(path, "merge", "--quiet", "main");
  } catch {
    // The conflict is the point.
  }

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  const [ref] = rescueRefs(f.source);
  assert.match(git(f.source, "show", `${ref}:README.md`), /<<<<<<< /u);
  assert.equal(
    git(f.source, "ls-tree", "--name-only", `${ref}^2`),
    "raw-index",
  );
});

test("writes made while processes are stopped are still saved", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  const env = {
    ...f.env,
    killProcessesUnder: async () => {
      await writeFile(join(path, "flushed-on-exit.txt"), "late\n");
    },
  };

  assert.deepEqual(await removeWorktree(env, { pathKey: KEY, path }), {
    status: "removed",
  });
  const [ref] = rescueRefs(f.source);
  assert.equal(git(f.source, "show", `${ref}:flushed-on-exit.txt`), "late");
});

test("re-creating a removed worktree keeps the branch's commits", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "work.txt"), "work\n");
  git(path, "add", "-A");
  git(path, "commit", "--quiet", "-m", "work");
  const tip = git(path, "rev-parse", "HEAD");
  await removeWorktree(f.env, { pathKey: KEY, path });

  const again = await provision(f, "thr_1-2");
  assert.equal(again.status, "created");
  assert.equal(git(f.source, "rev-parse", "bb/task-thr_1"), tip);
  assert.ok(f.logs.some((line) => line.includes("reusing it")));
});

test("cleaning up a launch that never got the path leaves the owner's worktree", async (t) => {
  const f = await fixture(t);
  const plan = (pathKey: string) =>
    resolveWorktree(f.env, {
      pathKey,
      sourcePath: f.source,
      branchName: "bb/task-thr_1",
      base: null,
    });
  // Both launches plan the same destination before either creates it.
  const winner = await plan("winner");
  const loser = await plan("loser");
  assert.equal(winner.status, "resolved");
  assert.equal(loser.status, "resolved");
  const created = await createWorktree(f.env, { pathKey: "winner" });
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  assert.deepEqual(
    await removeWorktree(f.env, { pathKey: "loser", path: null }),
    { status: "removed" },
  );
  assert.equal(existsSync(join(created.path, "README.md")), true);
});

test("two rescues in the same second get different refs", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  const now = new Date("2026-01-02T03:04:05Z");
  await writeFile(join(path, "a.txt"), "first\n");
  const first = await saveRescueSnapshot({ path, branch: null, now });
  await writeFile(join(path, "a.txt"), "second\n");
  const second = await saveRescueSnapshot({ path, branch: null, now });

  assert.notEqual(first, second);
  assert.equal(git(path, "show", `${first}:a.txt`), "first");
  assert.equal(git(path, "show", `${second}:a.txt`), "second");
});

test("a repeated create does not run the setup script again", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml":
      '[setup]\nscript = "echo run >> \\"$CODEX_WORKTREE_PATH.runs\\""\n',
  });
  const path = await provisioned(f);
  await provision(f);
  assert.equal(await readFile(`${path}.runs`, "utf8"), "run\n");
});

test("a submodule with unsaved work blocks removal", async (t) => {
  const f = await fixture(t);
  const library = join(f.base, "library");
  await mkdir(library);
  git(library, "init", "--quiet", "--initial-branch=main");
  git(library, "config", "user.email", "test@example.com");
  git(library, "config", "user.name", "Test");
  await writeFile(join(library, "lib.txt"), "lib\n");
  git(library, "add", "-A");
  git(library, "commit", "--quiet", "-m", "lib");
  git(
    f.source,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--quiet",
    library,
    "vendor",
  );
  git(f.source, "commit", "--quiet", "-m", "add submodule");

  const path = await provisioned(f);
  git(
    path,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "update",
    "--init",
    "--quiet",
  );
  await writeFile(join(path, "vendor", "lib.txt"), "edited in the worktree\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /vendor/u);
  assert.equal(
    await readFile(join(path, "vendor", "lib.txt"), "utf8"),
    "edited in the worktree\n",
  );
});
