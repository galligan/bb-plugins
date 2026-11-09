import { realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/**
 * Turns a project or branch name into one safe directory segment: separators
 * and unusual characters become `-`, and the result can never be `.`, `..` or
 * empty.
 */
export function slug(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  return cleaned === "" ? "unnamed" : cleaned;
}

/**
 * `<root>/<repo location...>/<branch>`, the layout every managed worktree
 * uses. The branch is flattened to one segment so a branch whose name prefixes
 * another (`a` and `a/b`) can never nest one worktree inside the other.
 */
export function worktreePath(
  root: string,
  location: readonly string[],
  branchName: string,
): string {
  return join(root, ...location, slug(branchName));
}

/** True only when `candidate` is a strict descendant of `root`. */
export function isUnder(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !rel.startsWith(sep)
  );
}

/**
 * `path` with every symlink in its longest existing prefix resolved. The part
 * that does not exist yet is appended unchanged.
 */
export async function canonical(path: string): Promise<string> {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    const real = await realpath(existing).catch(() => null);
    if (real !== null) return join(real, ...missing);
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    missing.unshift(basename(existing));
    existing = parent;
  }
}

/**
 * Like `isUnder`, but compares real locations, so a symlink anywhere along
 * `candidate` cannot make a path outside `root` look contained.
 */
export async function isContained(
  root: string,
  candidate: string,
): Promise<boolean> {
  return isUnder(await canonical(root), await canonical(candidate));
}
