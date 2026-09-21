// Resolves the stack chain for a project's environment, joining Graphite's
// metadata with BB's view of the workspace.
//
// This is the only place the two sides meet. `lib/stack/` stays free of the SDK.

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { graphiteHostContract } from "./host-contract.ts";

export interface CurrentStackRequest {
  readonly projectId: string;
  /** Prefer this thread's environment; falls back to the project's first. */
  readonly threadId?: string | null;
}

// Wire shapes. Plain data, so they match the RPC contract's inferred types
// without a cast; the readonly discipline lives in lib/stack/.
/** A BB thread whose environment has this branch checked out. */
export interface CurrentStackThread {
  id: string;
  title: string;
}

export interface CurrentStackOffshoot {
  name: string;
  /** Divergence column, 1 for the first line off the branch. Not generation depth. */
  column: number;
  /** The branch it hangs off; null when it hangs off the chain branch itself. */
  parent: string | null;
  needsRestack: boolean;
  isStale: boolean;
  threads: CurrentStackThread[];
}

export interface CurrentStackBranch {
  name: string;
  isCurrent: boolean;
  needsRestack: boolean;
  isStale: boolean;
  threads: CurrentStackThread[];
  /** Branches growing out of this one that the chain does not run through. */
  offshoots: CurrentStackOffshoot[];
}

export type CurrentStack =
  | {
      outcome: "stacked";
      branch: string;
      position: number;
      total: number;
      placement: "top" | "middle" | "bottom";
      needsRestack: boolean;
      isStale: boolean;
      workingTree: string | null;
      warnings: string[];
      branches: CurrentStackBranch[];
    }
  /** No stack to show: not a Graphite repo, branch untracked, or no environment. */
  | { outcome: "none"; reason: string };

function none(reason: string): CurrentStack {
  return { outcome: "none", reason };
}

/** The environment a command should act on: the thread's when there is one. */
export interface ResolvedEnvironment {
  readonly id: string;
  readonly path: string;
  readonly hostId: string;
  readonly isWorktree: boolean;
  readonly branchName: string;
  readonly workingTree: string;
}

export type EnvironmentResolution =
  | { readonly outcome: "resolved"; readonly environment: ResolvedEnvironment }
  | { readonly outcome: "unavailable"; readonly reason: string };

export async function resolveEnvironment(
  bb: BbPluginApi,
  request: CurrentStackRequest,
): Promise<EnvironmentResolution> {
  const environments = await bb.sdk.environments.list({ projectId: request.projectId });
  if (environments.length === 0) {
    return { outcome: "unavailable", reason: "no environment for this project" };
  }

  let chosen = environments[0];
  if (request.threadId != null) {
    const thread = await bb.sdk.threads
      .get({ threadId: request.threadId })
      .catch(() => null);
    if (thread === null) {
      return { outcome: "unavailable", reason: `thread ${request.threadId} was not found` };
    }
    const match =
      environments.find((candidate) => candidate.id === thread.environmentId);
    if (match === undefined) {
      return { outcome: "unavailable", reason: "thread is not in this project's environments" };
    }
    chosen = match;
  } else if (environments.length > 1) {
    return { outcome: "unavailable", reason: "project has multiple environments; pass --thread <id>" };
  }

  const path = chosen.path;
  if (path === null) return { outcome: "unavailable", reason: "environment has no workspace path" };
  if (!chosen.isGitRepo) return { outcome: "unavailable", reason: "workspace is not a git repository" };

  // Branch and working-tree state come from BB, never from a git call here.
  const status = await bb.sdk.environments.status({ environmentId: chosen.id });
  if (status.outcome !== "available") {
    return { outcome: "unavailable", reason: `environment ${status.outcome}` };
  }
  const checkout = status.workspace.checkout;
  if (checkout.kind !== "branch") {
    return { outcome: "unavailable", reason: `checkout is ${checkout.kind}` };
  }

  return {
    outcome: "resolved",
    environment: {
      id: chosen.id,
      path,
      hostId: chosen.hostId,
      isWorktree: chosen.isWorktree,
      branchName: checkout.branchName,
      workingTree: status.workspace.workingTree.state,
    },
  };
}

export async function currentStack(
  bb: BbPluginApi,
  request: CurrentStackRequest,
): Promise<CurrentStack> {
  const resolution = await resolveEnvironment(bb, request);
  if (resolution.outcome !== "resolved") return none(resolution.reason);
  const environment = resolution.environment;

  let stack;
  try {
    stack = await bb.hosts.experimental_client({ contract: graphiteHostContract }).call(
      "stack",
      { repoPath: environment.path, branchName: environment.branchName },
      { hostId: environment.hostId, timeoutMs: 10_000 },
    );
  } catch {
    return none("workspace host is unavailable");
  }
  if (stack.outcome === "none") return none(stack.reason);

  // Which thread is working on which branch — the join neither tool has alone.
  // Graphite cannot see BB's threads; BB does not know the branches form a stack.
  const byBranch = new Map<string, CurrentStackThread[]>();
  const environments = await bb.sdk.environments.list({ projectId: request.projectId });
  const environmentBranch = new Map<string, string>();
  for (const candidate of environments) {
    if (candidate.branchName !== null) environmentBranch.set(candidate.id, candidate.branchName);
  }
  if (environmentBranch.size > 0) {
    const threads = await bb.sdk.threads.list({ projectId: request.projectId, limit: 200 });
    for (const thread of threads) {
      const branchName =
        thread.environmentId === null ? undefined : environmentBranch.get(thread.environmentId);
      if (branchName === undefined) continue;
      const entry = {
        id: thread.id,
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
      };
      const existing = byBranch.get(branchName);
      if (existing === undefined) byBranch.set(branchName, [entry]);
      else existing.push(entry);
    }
  }
  const threadsFor = (name: string): CurrentStackThread[] => byBranch.get(name) ?? [];

  return {
    outcome: "stacked",
    branch: environment.branchName,
    position: stack.position,
    total: stack.total,
    placement: stack.placement,
    needsRestack: stack.needsRestack,
    isStale: stack.isStale,
    workingTree: environment.workingTree,
    warnings: stack.warnings,
    branches: stack.branches.map((branch) => ({
      name: branch.name,
      isCurrent: branch.isCurrent,
      needsRestack: branch.needsRestack,
      isStale: branch.isStale,
      threads: threadsFor(branch.name),
      offshoots: branch.offshoots.map((offshoot) => ({
        ...offshoot,
        threads: threadsFor(offshoot.name),
      })),
    })),
  };
}
