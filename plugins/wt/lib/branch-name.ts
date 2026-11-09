/** The prefix a branch gets when neither bb nor this plugin names one. */
export const DEFAULT_BRANCH_PREFIX = "bb/";

/**
 * A prefix git accepts at the start of a branch name: empty, or path-like
 * segments of ordinary characters. Rejects what `git check-ref-format` would,
 * for the forms a prefix can take.
 */
export function isValidBranchPrefix(prefix: string): boolean {
  if (prefix === "") return true;
  return (
    prefix.length <= 64 &&
    /^[A-Za-z0-9._/-]+$/u.test(prefix) &&
    !prefix.startsWith("/") &&
    !prefix.startsWith("-") &&
    !prefix.includes("..") &&
    !prefix.includes("//") &&
    !prefix.split("/").some((segment) => segment.startsWith("."))
  );
}

/**
 * The branch a new worktree gets, from the name bb suggests.
 *
 * bb's suggestion already carries bb's own branch prefix when one is set. With
 * prefixing on, the prefix is this plugin's when it has one, else bb's, else
 * `bb/`, so a worktree branch is always recognisable. With prefixing off, bb's
 * suggestion is used unchanged.
 */
export function branchName(options: {
  suggested: string;
  /** bb's `managedBranchPrefix` setting; empty when bb adds none. */
  bbPrefix: string;
  /** This plugin's own prefix setting; empty to defer to bb's. */
  pluginPrefix: string;
  /** This plugin's "prefix branches" setting. */
  enabled: boolean;
}): string {
  const { suggested, bbPrefix, pluginPrefix, enabled } = options;
  if (!enabled) return suggested;
  const bare =
    bbPrefix !== "" && suggested.startsWith(bbPrefix)
      ? suggested.slice(bbPrefix.length)
      : suggested;
  const prefix =
    pluginPrefix !== ""
      ? pluginPrefix
      : bbPrefix !== ""
        ? bbPrefix
        : DEFAULT_BRANCH_PREFIX;
  return `${prefix}${bare}`;
}
