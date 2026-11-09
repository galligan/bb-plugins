import { join, relative, sep } from "node:path";

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
