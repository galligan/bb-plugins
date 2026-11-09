import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { fixture, git, provision } from "./fixture.ts";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  resolveWorktree,
} from "./worktree.ts";

test("a repo with no remote lands under root/_local/<folder>/<branch>", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);

  assert.deepEqual(created, {
    status: "created",
    path: join(f.env.root, "_local", "repo", "bb-task-thr_1"),
    mergeBaseBranch: "main",
  });
  assert.equal(git(created.path, "branch", "--show-current"), "bb/task-thr_1");
  assert.equal(
    git(created.path, "rev-parse", "HEAD"),
    git(f.source, "rev-parse", "main"),
  );
});

test("create is idempotent for the same path key", async (t) => {
  const f = await fixture(t);
  const first = await provision(f);
  const second = await provision(f);
  assert.deepEqual(second, first);
});

test("refuses a path another launch already occupies", async (t) => {
  const f = await fixture(t);
  await provision(f, "thr_1-1");
  const clash = await resolveWorktree(f.env, {
    pathKey: "thr_1-2",
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: null,
  });
  assert.equal(clash.status, "failed");
});

test("an explicit base is used and reported as the merge base", async (t) => {
  const f = await fixture(t);
  git(f.source, "branch", "parent");
  const resolved = await resolveWorktree(f.env, {
    pathKey: "k",
    sourcePath: f.source,
    branchName: "child",
    base: "parent",
  });
  assert.equal(resolved.status, "resolved");
  const created = await createWorktree(f.env, { pathKey: "k" });
  assert.equal(created.status, "created");
  assert.equal(
    created.status === "created" && created.mergeBaseBranch,
    "parent",
  );
});

test("an unknown base fails before anything is created", async (t) => {
  const f = await fixture(t);
  const resolved = await resolveWorktree(f.env, {
    pathKey: "k",
    sourcePath: f.source,
    branchName: "child",
    base: "nope",
  });
  assert.equal(resolved.status, "failed");
  assert.equal(existsSync(f.env.root), false);
});

test("copies untracked files named by .worktreeinclude without overwriting", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env*\nsecrets/\n",
    ".worktreeinclude": "# local env\n.env*\n!.env.skip\nsecrets/\n",
  });
  await writeFile(join(f.source, ".env"), "TOKEN=1\n");
  await writeFile(join(f.source, ".env.local"), "LOCAL=1\n");
  await writeFile(join(f.source, ".env.skip"), "SKIP=1\n");
  await mkdir(join(f.source, "secrets"));
  await writeFile(join(f.source, "secrets", "key"), "k\n");
  await writeFile(join(f.source, "untracked.txt"), "not shared\n");

  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  assert.equal(await readFile(join(created.path, ".env"), "utf8"), "TOKEN=1\n");
  assert.equal(
    await readFile(join(created.path, ".env.local"), "utf8"),
    "LOCAL=1\n",
  );
  assert.equal(
    await readFile(join(created.path, "secrets/key"), "utf8"),
    "k\n",
  );
  assert.equal(existsSync(join(created.path, ".env.skip")), false);
  assert.equal(existsSync(join(created.path, "untracked.txt")), false);

  // A resumed create must not replace what the worktree already has.
  await writeFile(join(created.path, ".env"), "EDITED=1\n");
  await provision(f);
  assert.equal(
    await readFile(join(created.path, ".env"), "utf8"),
    "EDITED=1\n",
  );
});

test("runs the Codex setup script in the worktree and cleanup on removal", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml": [
      "[setup]",
      'script = "echo setup-ran > \\"$CODEX_WORKTREE_PATH/setup.marker\\""',
      "[cleanup]",
      'script = "echo cleanup-ran > \\"$CODEX_WORKTREE_PATH.cleanup\\""',
      "",
    ].join("\n"),
  });
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.equal(
    await readFile(join(created.path, "setup.marker"), "utf8"),
    "setup-ran\n",
  );

  const removed = await removeWorktree(f.env, {
    pathKey: "thr_1-1",
    path: created.path,
  });
  assert.deepEqual(removed, { status: "removed" });
  assert.equal(
    await readFile(`${created.path}.cleanup`, "utf8"),
    "cleanup-ran\n",
  );
});

test("a failing setup script fails creation with its output", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml":
      '[setup]\nscript = "echo boom >&2; exit 3"\n',
  });
  const created = await provision(f);
  assert.equal(created.status, "failed");
  assert.match(
    created.status === "failed" ? created.message : "",
    /exit code 3/u,
  );
  assert.ok(f.logs.some((line) => line.includes("boom")));
});

test("defers to bb core when the repo has a bb hook", async (t) => {
  const f = await fixture(t, {
    ".bb-env-setup.sh": "echo hook\n",
    ".codex/environments/environment.toml":
      '[setup]\nscript = "touch codex.marker"\n',
  });
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.equal(existsSync(join(created.path, "codex.marker")), false);
});

test("remove deletes a dirty worktree, keeps the branch, and is repeatable", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  await writeFile(join(created.path, "dirty.txt"), "x\n");

  const input = { pathKey: "thr_1-1", path: created.path };
  assert.deepEqual(await removeWorktree(f.env, input), { status: "removed" });
  assert.equal(existsSync(created.path), false);
  assert.equal(git(f.source, "branch", "--list", "bb/task-thr_1") !== "", true);
  assert.equal(git(f.source, "worktree", "list").includes("bb-task"), false);
  assert.deepEqual(await removeWorktree(f.env, input), { status: "removed" });
});

test("remove works from the path key alone", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.deepEqual(
    await removeWorktree(f.env, { pathKey: "thr_1-1", path: null }),
    { status: "removed" },
  );
  assert.equal(existsSync(created.path), false);
});

test("remove refuses a path outside the managed root", async (t) => {
  const f = await fixture(t);
  const removed = await removeWorktree(f.env, {
    pathKey: "unknown",
    path: f.source,
  });
  assert.equal(removed.status, "failed");
  assert.equal(existsSync(join(f.source, "README.md")), true);
});

test("the folder follows the origin remote, not the checkout", async (t) => {
  const f = await fixture(t);
  git(
    f.source,
    "remote",
    "add",
    "origin",
    "git@github.com:outfitter-dev/trails.git",
  );
  const created = await provision(f);
  assert.equal(
    created.status === "created" && created.path,
    join(f.env.root, "gh", "outfitter-dev", "trails", "bb-task-thr_1"),
  );
});

test("remove saves uncommitted and untracked files to a rescue ref first", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  await writeFile(join(created.path, "README.md"), "edited\n");
  await writeFile(join(created.path, "notes.txt"), "new\n");

  assert.deepEqual(
    await removeWorktree(f.env, { pathKey: "thr_1-1", path: created.path }),
    { status: "removed" },
  );
  const ref = git(
    f.source,
    "for-each-ref",
    "--format=%(refname)",
    "refs/wt-rescue",
  );
  assert.match(
    ref,
    /^refs\/wt-rescue\/bb-task-thr_1-20260102030405-[0-9a-f]{10}$/u,
  );
  assert.equal(git(f.source, "show", `${ref}:README.md`), "edited");
  assert.equal(git(f.source, "show", `${ref}:notes.txt`), "new");
  assert.ok(f.logs.some((line) => line.includes(ref)));
  // The source checkout itself is untouched.
  assert.equal(git(f.source, "status", "--porcelain"), "");
});

test("a clean worktree is removed without leaving a rescue ref", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  await removeWorktree(f.env, { pathKey: "thr_1-1", path: created.path });
  assert.equal(git(f.source, "for-each-ref", "refs/wt-rescue"), "");
});

test("list reports each recorded worktree, including ones whose folder is gone", async (t) => {
  const f = await fixture(t);
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  const [present] = await listWorktrees(f.env);
  assert.equal(present?.status, "present");
  assert.equal(
    present?.status === "present" && present.inspection.safeToRemove,
    true,
  );

  git(f.source, "worktree", "remove", "--force", created.path);
  assert.deepEqual(await listWorktrees(f.env), [
    { status: "missing", pathKey: "thr_1-1", path: created.path },
  ]);
});
