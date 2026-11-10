import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectScripts } from "./script-overrides.ts";
import { test } from "node:test";

import { fixture, git, provision } from "./fixture.ts";
import {
  createWorktree,
  defaultBase,
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

test("with no base given, the branch starts from the remote's default branch", async (t) => {
  const f = await fixture(t);
  const remote = join(f.base, "remote.git");
  git(f.base, "init", "--quiet", "--bare", remote);
  git(f.source, "remote", "add", "origin", remote);
  git(f.source, "push", "--quiet", "origin", "main");
  git(f.source, "remote", "set-head", "origin", "main");
  const pushed = git(f.source, "rev-parse", "origin/main");
  // Local main moves on without being pushed.
  await writeFile(join(f.source, "local.txt"), "unpushed\n");
  git(f.source, "add", "-A");
  git(f.source, "commit", "--quiet", "-m", "local only");

  const resolved = await resolveWorktree(f.env, {
    pathKey: "k",
    sourcePath: f.source,
    branchName: "bb/from-remote",
    base: null,
  });
  assert.equal(resolved.status, "resolved");
  const created = await createWorktree(f.env, { pathKey: "k" });
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.equal(created.mergeBaseBranch, "origin/main");
  assert.equal(git(created.path, "rev-parse", "HEAD"), pushed);
});

test("defaultBase names the ref a launch without a base would use", async (t) => {
  const f = await fixture(t);
  assert.equal(await defaultBase(f.source), "main");
  const remote = join(f.base, "remote.git");
  git(f.base, "init", "--quiet", "--bare", remote);
  git(f.source, "remote", "add", "origin", remote);
  git(f.source, "push", "--quiet", "origin", "main");
  git(f.source, "remote", "set-head", "origin", "main");
  assert.equal(await defaultBase(f.source), "origin/main");
});

test("custom setup runs in the worktree with reported output and is never replayed", async (t) => {
  const f = await fixture(t);
  const script = {
    setup: {
      mode: "custom",
      script:
        'echo custom-setup; echo run >> "$CODEX_WORKTREE_PATH.runs"; test "$PWD" = "$CODEX_WORKTREE_PATH"',
    },
    cleanup: { mode: "detected", script: null },
  } satisfies ProjectScripts;
  const resolved = await resolveWorktree(f.env, {
    pathKey: "custom",
    sourcePath: f.source,
    branchName: "bb/custom",
    base: null,
    scripts: script,
  });
  assert.equal(resolved.status, "resolved");
  const created = await createWorktree(f.env, { pathKey: "custom" });
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.ok(f.logs.some((line) => line.includes("custom-setup")));
  await createWorktree(f.env, { pathKey: "custom" });
  assert.equal(await readFile(`${created.path}.runs`, "utf8"), "run\n");
});

test("off skips detected scripts, and captured cleanup runs before rescue despite later settings", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml":
      '[setup]\nscript = "exit 99"\n[cleanup]\nscript = "exit 98"\n',
  });
  const scripts = {
    setup: { mode: "off", script: null },
    cleanup: {
      mode: "custom",
      script: "echo original-cleanup > rescued.txt; exit 1",
    },
  } satisfies ProjectScripts;
  const input = {
    pathKey: "snapshot",
    sourcePath: f.source,
    branchName: "bb/snapshot",
    base: null,
    scripts,
  };
  const planned = await resolveWorktree(f.env, input);
  assert.equal(planned.status, "resolved");
  const created = await createWorktree(f.env, { pathKey: "snapshot" });
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  // A later launch resolution observes changed project preferences; the existing record is immutable.
  await resolveWorktree(f.env, {
    ...input,
    scripts: {
      ...scripts,
      cleanup: { mode: "custom", script: "echo changed > rescued.txt" },
    },
  });
  assert.deepEqual(
    await removeWorktree(f.env, { pathKey: "snapshot", path: null }),
    { status: "removed" },
  );
  const ref = git(
    f.source,
    "for-each-ref",
    "--format=%(refname)",
    "refs/wt-rescue",
  );
  assert.equal(git(f.source, "show", `${ref}:rescued.txt`), "original-cleanup");
  assert.ok(f.logs.some((line) => line.includes("Cleanup script failed")));
});

test("either bb hook suppresses all custom scripts", async (t) => {
  for (const hook of [".bb-env-setup.sh", ".bb-env-teardown.sh"])
    await t.test(hook, async (t) => {
      const f = await fixture(t, { [hook]: "exit 99" });
      const scripts = {
        setup: { mode: "custom", script: "exit 88" },
        cleanup: {
          mode: "custom",
          script: 'echo bad > "$CODEX_WORKTREE_PATH.cleaned"',
        },
      } satisfies ProjectScripts;
      await resolveWorktree(f.env, {
        pathKey: "hook",
        sourcePath: f.source,
        branchName: "bb/hook",
        base: null,
        scripts,
      });
      const created = await createWorktree(f.env, { pathKey: "hook" });
      assert.equal(created.status, "created");
      if (created.status !== "created") return;
      assert.deepEqual(
        await removeWorktree(f.env, { pathKey: "hook", path: null }),
        { status: "removed" },
      );
      assert.equal(existsSync(`${created.path}.cleaned`), false);
      assert.equal(
        f.logs.some(
          (line) =>
            line.includes("Running setup") || line.includes("Running cleanup"),
        ),
        false,
      );
    });
});

test("old records without scripts still run detected cleanup", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml":
      '[cleanup]\nscript = "echo old-cleanup > old.txt"\n',
  });
  const created = await provision(f);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  const file = join(f.env.dataDir, "worktrees", "thr_1-1.json");
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  assert.ok(typeof raw === "object" && raw !== null);
  await writeFile(file, JSON.stringify({ ...raw, scripts: undefined }));
  assert.deepEqual(
    await removeWorktree(f.env, { pathKey: "thr_1-1", path: null }),
    { status: "removed" },
  );
  const ref = git(
    f.source,
    "for-each-ref",
    "--format=%(refname)",
    "refs/wt-rescue",
  );
  assert.equal(git(f.source, "show", `${ref}:old.txt`), "old-cleanup");
});

test("a custom setup marked running is never replayed after failure", async (t) => {
  const f = await fixture(t);
  await resolveWorktree(f.env, {
    pathKey: "interrupted",
    sourcePath: f.source,
    branchName: "bb/interrupted",
    base: null,
    scripts: {
      setup: {
        mode: "custom",
        script: 'echo run >> "$CODEX_WORKTREE_PATH.runs"; exit 1',
      },
      cleanup: { mode: "off", script: null },
    },
  });
  const first = await createWorktree(f.env, { pathKey: "interrupted" });
  assert.equal(first.status, "failed");
  const second = await createWorktree(f.env, { pathKey: "interrupted" });
  assert.equal(second.status, "failed");
  if (second.status === "failed")
    assert.match(second.message, /outcome is unknown/u);
  const [entry] = await listWorktrees(f.env);
  assert.equal(entry?.status, "present");
  if (entry?.status === "present")
    assert.equal(
      await readFile(`${entry.inspection.path}.runs`, "utf8"),
      "run\n",
    );
});

test("malformed Codex configuration cannot block custom or Off steps", async (t) => {
  for (const mode of ["custom", "off"] satisfies ("custom" | "off")[])
    await t.test(mode, async (t) => {
      const f = await fixture(t, {
        ".codex/environments/environment.toml": "[broken",
      });
      const scripts = {
        setup: {
          mode,
          script:
            mode === "custom" ? "echo custom-with-malformed-config" : null,
        },
        cleanup: {
          mode,
          script: mode === "custom" ? "echo saved-cleanup > marker" : null,
        },
      } satisfies ProjectScripts;
      await resolveWorktree(f.env, {
        pathKey: "malformed",
        sourcePath: f.source,
        branchName: "bb/malformed",
        base: null,
        scripts,
      });
      const created = await createWorktree(f.env, { pathKey: "malformed" });
      assert.equal(created.status, "created");
      assert.deepEqual(
        await removeWorktree(f.env, { pathKey: "malformed", path: null }),
        { status: "removed" },
      );
      if (mode === "custom") {
        assert.ok(
          f.logs.some((line) => line.includes("custom-with-malformed-config")),
        );
        const ref = git(
          f.source,
          "for-each-ref",
          "--format=%(refname)",
          "refs/wt-rescue",
        );
        assert.equal(git(f.source, "show", `${ref}:marker`), "saved-cleanup");
      }
    });
});

test("detected setup still fails on malformed Codex configuration", async (t) => {
  const f = await fixture(t, {
    ".codex/environments/environment.toml": "[broken",
  });
  const created = await provision(f);
  assert.equal(created.status, "failed");
  if (created.status === "failed")
    assert.match(created.message, /Could not read/u);
});
