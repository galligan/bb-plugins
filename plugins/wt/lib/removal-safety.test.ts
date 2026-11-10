// Regression tests for the ways removal or re-creation could lose work.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  fixture,
  git,
  provision,
  provisioned,
  type Fixture,
} from "./fixture.ts";
import { saveRescueSnapshot } from "./inspect.ts";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  resolveWorktree,
} from "./worktree.ts";

const KEY = "thr_1-1";

/** Provisions a worktree whose `vendor` folder is an initialized submodule. */
async function withSubmodule(f: Fixture): Promise<string> {
  const library = join(f.base, "library");
  await mkdir(library);
  git(library, "init", "--quiet", "--initial-branch=main");
  git(library, "config", "user.email", "test@example.com");
  git(library, "config", "user.name", "Test");
  await writeFile(join(library, "lib.txt"), "lib\n");
  git(library, "add", "-A");
  git(library, "commit", "--quiet", "-m", "lib");
  const allow = ["-c", "protocol.file.allow=always"];
  git(f.source, ...allow, "submodule", "add", "--quiet", library, "vendor");
  git(f.source, "commit", "--quiet", "-m", "add submodule");
  const path = await provisioned(f);
  git(path, ...allow, "submodule", "update", "--init", "--quiet");
  return path;
}
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

test("unresolved conflicts block removal, since they cannot be saved", async (t) => {
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

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /conflict/u);
  assert.match(await readFile(join(path, "README.md"), "utf8"), /<<<<<<< /u);
  assert.deepEqual(rescueRefs(f.source), []);
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
  const path = await withSubmodule(f);
  await writeFile(join(path, "vendor", "lib.txt"), "edited in the worktree\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /vendor/u);
  assert.equal(
    await readFile(join(path, "vendor", "lib.txt"), "utf8"),
    "edited in the worktree\n",
  );
});

test("a destination occupied by something else is never treated as owned", async (t) => {
  const f = await fixture(t);
  const resolved = await resolveWorktree(f.env, {
    pathKey: KEY,
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: null,
  });
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  // Something unrelated appears at the planned destination before create runs.
  await mkdir(resolved.path, { recursive: true });
  await writeFile(join(resolved.path, "foreign.txt"), "not ours\n");

  const created = await createWorktree(f.env, { pathKey: KEY });
  assert.equal(created.status, "failed");
  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path: null }), {
    status: "removed",
  });
  assert.equal(
    await readFile(join(resolved.path, "foreign.txt"), "utf8"),
    "not ours\n",
  );
});

test("create rechecks containment when the plan is older than a symlink", async (t) => {
  const f = await fixture(t);
  const resolved = await resolveWorktree(f.env, {
    pathKey: KEY,
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: null,
  });
  assert.equal(resolved.status, "resolved");
  const outside = join(f.base, "outside");
  await mkdir(outside);
  await mkdir(f.env.root, { recursive: true });
  await symlink(outside, join(f.env.root, "_local"));

  const created = await createWorktree(f.env, { pathKey: KEY });
  assert.equal(created.status, "failed");
  assert.equal(existsSync(join(outside, "repo")), false);
});

test("a submodule's unsaved work blocks removal even without .gitmodules", async (t) => {
  const f = await fixture(t);
  const path = await withSubmodule(f);
  await writeFile(join(path, "vendor", "lib.txt"), "edited in the worktree\n");
  await rm(join(path, ".gitmodules"));

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.equal(
    await readFile(join(path, "vendor", "lib.txt"), "utf8"),
    "edited in the worktree\n",
  );
});

test("a damaged record can still be cleaned up and is listed", async (t) => {
  const f = await fixture(t);
  await provisioned(f);
  const file = join(f.env.dataDir, "worktrees", `${KEY}.json`);
  await writeFile(file, '{"pathKey": "thr_1-');

  const [listed] = await listWorktrees(f.env);
  assert.equal(listed?.status, "unreadable");
  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path: null }), {
    status: "removed",
  });
  assert.equal(existsSync(file), false);
});

test("a removed submodule's local-only commits block removal", async (t) => {
  const f = await fixture(t);
  const path = await withSubmodule(f);
  // A second submodule stays initialized while the first is removed.
  const other = join(f.base, "other");
  git(f.base, "init", "--quiet", "--initial-branch=main", other);
  git(other, "config", "user.email", "test@example.com");
  git(other, "config", "user.name", "Test");
  await writeFile(join(other, "o.txt"), "o\n");
  git(other, "add", "-A");
  git(other, "commit", "--quiet", "-m", "other");
  const allow = ["-c", "protocol.file.allow=always"];
  git(path, ...allow, "submodule", "add", "--quiet", other, "second");
  git(path, "commit", "--quiet", "-m", "add second");

  const vendor = join(path, "vendor");
  git(vendor, "config", "user.email", "test@example.com");
  git(vendor, "config", "user.name", "Test");
  await writeFile(join(vendor, "local.txt"), "only here\n");
  git(vendor, "add", "-A");
  git(vendor, "commit", "--quiet", "-m", "local only");
  git(path, "rm", "-f", "--quiet", "vendor");
  git(path, "commit", "--quiet", "-m", "drop vendor");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /vendor/u);
  assert.equal(existsSync(path), true);
});

test("a worktree left by a failing checkout hook is cleaned up, not forgotten", async (t) => {
  const f = await fixture(t);
  const hook = join(f.source, ".git", "hooks", "post-checkout");
  await mkdir(join(f.source, ".git", "hooks"), { recursive: true });
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);

  const created = await provision(f);
  assert.equal(created.status, "failed");
  const path = join(f.env.root, "_local", "repo", "bb-task-thr_1");
  assert.equal(existsSync(path), true);

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path: null }), {
    status: "removed",
  });
  assert.equal(existsSync(path), false);
  // The next launch can use the destination again.
  await rm(hook);
  const again = await provision(f, "thr_1-2");
  assert.equal(again.status, "created");
});

test("a worktree that replaced this launch's at the same path is left alone", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  git(f.source, "worktree", "remove", "--force", path);
  git(f.source, "worktree", "add", "--quiet", "-b", "someone-else", path);
  await writeFile(join(path, "theirs.txt"), "not this launch's\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.equal(
    await readFile(join(path, "theirs.txt"), "utf8"),
    "not this launch's\n",
  );
});

test("an empty folder left at the path is not deleted", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  git(f.source, "worktree", "remove", "--force", path);
  await mkdir(path);

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.equal(existsSync(path), true);
});

test("a worktree whose work moved to another branch is still this launch's", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  git(path, "switch", "--quiet", "-c", "stacked-on-top");

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  assert.equal(existsSync(path), false);
});

test("a damaged record does not stop a marked worktree being removed", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(f.env.dataDir, "worktrees", `${KEY}.json`), "{");

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  assert.equal(existsSync(path), false);
});

test("a paused rebase blocks removal even with nothing in conflict", async (t) => {
  const f = await fixture(t);
  const path = await provisioned(f);
  await writeFile(join(path, "a.txt"), "a\n");
  git(path, "add", "-A");
  git(path, "commit", "--quiet", "-m", "a");
  await writeFile(join(path, "b.txt"), "b\n");
  git(path, "add", "-A");
  git(path, "commit", "--quiet", "-m", "b");
  // Stop at the first commit, as an `edit` step does.
  git(
    path,
    "-c",
    "sequence.editor=sed -i.bak 1s/^pick/edit/",
    "rebase",
    "--quiet",
    "-i",
    "HEAD~2",
  );

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /rebase/u);
  assert.equal(existsSync(join(path, "a.txt")), true);
});

test("shared files are not copied through a symlink out of the worktree", async (t) => {
  const f = await fixture(t, {
    ".gitignore": "local/\n",
    ".worktreeinclude": "local/\n",
  });
  const outside = join(f.base, "outside");
  await mkdir(outside);
  // The base branch tracks `local` as a symlink; the checkout the files are
  // copied from has since replaced it with a real, ignored folder.
  await symlink(outside, join(f.source, "local"));
  git(f.source, "add", "-f", "local");
  git(f.source, "commit", "--quiet", "-m", "link");
  git(f.source, "rm", "--quiet", "--cached", "local");
  await rm(join(f.source, "local"));
  await mkdir(join(f.source, "local"));
  await writeFile(join(f.source, "local", "secret"), "s\n");

  await resolveWorktree(f.env, {
    pathKey: KEY,
    sourcePath: f.source,
    branchName: "bb/task-thr_1",
    base: "HEAD",
  });
  const created = await createWorktree(f.env, { pathKey: KEY });
  assert.equal(created.status, "created");
  assert.equal(existsSync(join(outside, "secret")), false);
});

test("an edited ignored shared file blocks removal and stays out of git", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env\n",
    ".worktreeinclude": ".env\n",
  });
  await writeFile(join(f.source, ".env"), "TOKEN=1\n");
  const path = await provisioned(f);
  await writeFile(join(path, ".env"), "TOKEN=edited\n");
  await writeFile(join(path, "notes.txt"), "draft\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
  assert.match(removed.status === "failed" ? removed.message : "", /\.env/u);
  assert.equal(await readFile(join(path, ".env"), "utf8"), "TOKEN=edited\n");
  // Nothing was saved to git, so the secret is in no object.
  assert.deepEqual(rescueRefs(f.source), []);

  await writeFile(join(path, ".env"), "TOKEN=1\n");
  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  const [ref] = rescueRefs(f.source);
  assert.equal(git(f.source, "show", `${ref ?? ""}:notes.txt`), "draft");
  assert.equal(
    git(f.source, "ls-tree", "-r", "--name-only", ref ?? "").includes(".env"),
    false,
  );
});

test("a shared file changed only in the source checkout does not block removal", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env\n",
    ".worktreeinclude": ".env\n",
  });
  await writeFile(join(f.source, ".env"), "TOKEN=1\n");
  const path = await provisioned(f);
  await writeFile(join(f.source, ".env"), "TOKEN=rotated\n");

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
});

test("without a recorded copy, a shared file that differs from the source blocks removal", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env\n",
    ".worktreeinclude": ".env\n",
  });
  await writeFile(join(f.source, ".env"), "TOKEN=1\n");
  const path = await provisioned(f);
  const file = join(f.env.dataDir, "worktrees", `${KEY}.json`);
  const record: unknown = JSON.parse(await readFile(file, "utf8"));
  assert.ok(typeof record === "object" && record !== null);
  await writeFile(file, JSON.stringify({ ...record, sharedFiles: undefined }));
  await writeFile(join(f.source, ".env"), "TOKEN=rotated\n");

  const removed = await removeWorktree(f.env, { pathKey: KEY, path });
  assert.equal(removed.status, "failed");
});

test("an edited shared file git does not ignore is rescued, not a blocker", async (t) => {
  const f = await fixture(t, { ".worktreeinclude": "notes.txt\n" });
  await writeFile(join(f.source, "notes.txt"), "draft\n");
  const path = await provisioned(f);
  await writeFile(join(path, "notes.txt"), "edited\n");

  assert.deepEqual(await removeWorktree(f.env, { pathKey: KEY, path }), {
    status: "removed",
  });
  const [ref] = rescueRefs(f.source);
  assert.equal(git(f.source, "show", `${ref ?? ""}:notes.txt`), "edited");
});
