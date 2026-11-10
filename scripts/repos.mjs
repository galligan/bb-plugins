import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

export function readManifest(root) {
  const slugs = JSON.parse(readFileSync(path.join(root, "repos.json"), "utf8"));
  if (
    !Array.isArray(slugs) ||
    !slugs.every(
      (slug) =>
        typeof slug === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(slug),
    ) ||
    new Set(slugs.map((slug) => slug.toLowerCase())).size !== slugs.length
  ) {
    throw new Error("repos.json must contain unique GitHub owner/repo strings");
  }
  const destinations = slugs.map((slug) =>
    slug.replace("/", "--").toLowerCase(),
  );
  if (new Set(destinations).size !== destinations.length) {
    throw new Error("repos.json contains references that collide on disk");
  }
  return slugs;
}

function validateCheckout(target, remote) {
  // Compare the configured origin before Git applies transport URL rewrites.
  if (
    lstatSync(target).isSymbolicLink() ||
    !existsSync(path.join(target, ".git")) ||
    git(["config", "--get", "remote.origin.url"], target) !== remote
  ) {
    throw new Error(`Unexpected checkout at ${target}; inspect it manually`);
  }
}

export function syncRepos(root, action) {
  if (!["clone", "pull"].includes(action)) {
    throw new Error("Usage: bun run repos <clone|pull>");
  }
  const slugs = readManifest(root);
  const worktrees = git(["worktree", "list", "--porcelain", "-z"], root)
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice(9));
  for (const slug of slugs) {
    const name = slug.replace("/", "--");
    const target = path.join(root, "repos", name);
    const remote = `https://github.com/${slug}.git`;
    if (existsSync(target)) {
      validateCheckout(target, remote);
      if (action === "pull") {
        if (git(["status", "--porcelain"], target)) {
          throw new Error(`Local changes in ${target}; inspect before pulling`);
        }
        git(["pull", "--ff-only"], target);
      }
      console.log(
        `${slug}: ${action === "pull" ? "updated" : "already cloned"}`,
      );
      continue;
    }
    const seed = worktrees
      .map((worktree) => path.join(worktree, "repos", name))
      .find((candidate) => {
        if (!existsSync(candidate)) return false;
        try {
          validateCheckout(candidate, remote);
          return true;
        } catch {
          return false;
        }
      });
    // Independent copies survive removal of the worktree that supplied them.
    git(["clone", "--no-hardlinks", seed ?? remote, target], root);
    if (seed) git(["remote", "set-url", "origin", remote], target);
    if (action === "pull") git(["pull", "--ff-only"], target);
    console.log(
      `${slug}: cloned${seed ? " from a local worktree" : " from GitHub"}`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Usage: bun run repos <clone|pull>");
    syncRepos(root, process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
