// Reads a Graphite stack from a repository path.
//
// This module imports no BB SDK and never invokes `gt`. It shells out to git plumbing
// and reads Graphite's metadata database directly, which is the only way to observe a
// branch whose recorded revision has fallen behind the repository: any `gt` invocation
// silently refreshes that value. See docs/agents/graphite.md.

import { buildStack } from "./graph.ts";
import { readBranchHeads, readGitCommonDir } from "./git.ts";
import { readBranchRecords, readTrunkName } from "./metadata.ts";
import type { StackSnapshot } from "./types.ts";

export interface ReadStackOptions {
  /** Any path inside the repository or one of its worktrees. */
  readonly repoPath: string;
  /** Absolute path to git when it is not on the workspace host's PATH. */
  readonly gitBinary?: string;
}

/**
 * Throws `StackReadError` only when no snapshot exists: the path is not a repository,
 * or Graphite has no metadata there. Every per-branch problem is reported in
 * `snapshot.issues` instead.
 */
export async function readStack(options: ReadStackOptions): Promise<StackSnapshot> {
  const gitCommonDir = await readGitCommonDir(options);
  const heads = await readBranchHeads(options);
  const { records, issues, schema } = readBranchRecords(gitCommonDir);
  const trunk = readTrunkName(gitCommonDir);

  const built = buildStack({ records, heads, trunk });

  return {
    gitCommonDir,
    trunk,
    schema,
    branches: built.branches,
    roots: built.roots,
    cycles: built.cycles,
    issues: [...issues, ...built.issues],
  };
}

export { buildStack } from "./graph.ts";
export { stackChain, stackOffshoots } from "./chain.ts";
export type { StackChain, StackOffshoot } from "./chain.ts";
export { KNOWN_MIGRATIONS, METADATA_FILENAME, REPO_CONFIG_FILENAME } from "./metadata.ts";
export type { BranchRecord } from "./metadata.ts";
export { StackReadError } from "./types.ts";
export type {
  MetadataSchema,
  StackBranch,
  StackIssue,
  StackReadErrorCode,
  StackSnapshot,
} from "./types.ts";
