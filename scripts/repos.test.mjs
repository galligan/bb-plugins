import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readManifest, syncRepos } from "./repos.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("worktrees get independent ignored clones with their GitHub origin preserved", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "bb-plugin-repos-"));
  try {
    const source = path.join(temp, "source");
    const target = path.join(temp, "target");
    mkdirSync(source);
    git(source, "init", "-q");
    writeFileSync(path.join(source, "repos.json"), '["example/plugin"]');
    writeFileSync(path.join(source, ".gitignore"), "/repos/\n");
    git(source, "add", ".");
    git(
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    );
    const seed = path.join(source, "repos/example--plugin");
    mkdirSync(seed, { recursive: true });
    git(seed, "init", "-q");
    git(
      seed,
      "remote",
      "add",
      "origin",
      "https://github.com/example/plugin.git",
    );
    writeFileSync(path.join(seed, "README.md"), "reference source\n");
    git(seed, "add", ".");
    git(
      seed,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "reference",
    );
    git(source, "worktree", "add", "--detach", target);
    syncRepos(target, "clone");
    const clone = path.join(target, "repos/example--plugin");
    assert.equal(
      git(clone, "remote", "get-url", "origin"),
      "https://github.com/example/plugin.git",
    );
    assert.equal(git(target, "status", "--porcelain"), "");
    // Keep the seed at A while a local stand-in for GitHub advances to B.
    const upstream = path.join(temp, "upstream");
    git(source, "clone", seed, upstream);
    writeFileSync(path.join(upstream, "README.md"), "updated reference\n");
    git(upstream, "add", ".");
    git(
      upstream,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "update",
    );
    const syncWithUpstream = (action) =>
      execFileSync(
        process.execPath,
        [
          "--eval",
          `import { syncRepos } from ${JSON.stringify(new URL("./repos.mjs", import.meta.url).href)}; syncRepos(${JSON.stringify(target)}, ${JSON.stringify(action)});`,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `url.${upstream}.insteadOf`,
            GIT_CONFIG_VALUE_0: "https://github.com/example/plugin.git",
          },
        },
      );
    rmSync(clone, { recursive: true });
    syncWithUpstream("clone");
    assert.equal(git(clone, "show", "HEAD:README.md"), "reference source");
    rmSync(clone, { recursive: true });
    syncWithUpstream("pull");
    assert.equal(
      git(clone, "rev-parse", "HEAD"),
      git(upstream, "rev-parse", "HEAD"),
    );
    assert.equal(git(seed, "show", "HEAD:README.md"), "reference source");
    rmSync(clone, { recursive: true });
    rmSync(upstream, { recursive: true });
    assert.throws(
      () => syncWithUpstream("pull"),
      /does not appear to be a git repository/,
    );
    assert.equal(git(clone, "show", "HEAD:README.md"), "reference source");
    rmSync(seed, { recursive: true });
    assert.equal(git(clone, "show", "HEAD:README.md"), "reference source");
    syncRepos(target, "clone");
    writeFileSync(path.join(clone, "README.md"), "local edits\n");
    assert.throws(() => syncRepos(target, "pull"), /Local changes/);
    assert.equal(
      readFileSync(path.join(clone, "README.md"), "utf8"),
      "local edits\n",
    );
    git(
      clone,
      "remote",
      "set-url",
      "origin",
      "https://github.com/wrong/plugin.git",
    );
    assert.throws(() => syncRepos(target, "clone"), /Unexpected checkout/);
    writeFileSync(path.join(target, "repos.json"), '["../escape"]');
    assert.throws(() => readManifest(target), /unique GitHub/);
    assert.throws(() => syncRepos(target, "unknown"), /Usage/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("destination collisions fail before any cloning, including case-only collisions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bb-plugin-manifest-"));
  try {
    for (const slugs of [
      ["a--b/c", "a/b--c"],
      ["A--b/c", "a/B--c"],
    ]) {
      writeFileSync(path.join(root, "repos.json"), JSON.stringify(slugs));
      assert.throws(() => syncRepos(root, "clone"), /collide on disk/);
      assert.equal(existsSync(path.join(root, "repos")), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
