// The single line through a stack that contains one branch.
//
// A repository can hold many unrelated stacks — 158 branches across 40 roots in
// ~/Developer/outfitter/skillset. A surface that shows all of them shows nothing.
// This reduces a snapshot to the one chain the caller is standing in.
//
// Pure: a snapshot in, a chain out.

import type { StackBranch, StackSnapshot } from "./types.ts";

/**
 * A branch hanging off the chain rather than on it.
 *
 * `column` counts divergences, not generations, the way `gt ls` draws them: a
 * straight run of branches stays in one column however long it is, and only a
 * fork opens another. Indenting by generation turns a linear five-branch offshoot
 * into a staircase that implies a structure the repository does not have.
 */
export interface StackOffshoot {
  readonly name: string;
  readonly column: number;
  /** The branch this one hangs off. Null when it hangs off the chain itself. */
  readonly parent: string | null;
  readonly needsRestack: boolean;
  readonly isStale: boolean;
}

export interface StackChain {
  /** Root first, deepest descendant last. Always contains `branch`. */
  readonly branches: readonly StackBranch[];
  /** 1-based index of the requested branch within `branches`. */
  readonly position: number;
  readonly total: number;
  /** Where the requested branch sits, for the position icon. */
  readonly placement: "top" | "middle" | "bottom";
  /**
   * A branch at or below the requested one is stacked on a stale parent. Below
   * matters: restacking it moves everything above, including the requested branch.
   */
  readonly needsRestack: boolean;
  /** Graphite's recorded head disagrees with git for some branch in the chain. */
  readonly isStale: boolean;
}

function placementOf(position: number, total: number): StackChain["placement"] {
  if (total <= 1 || position === 1) return "bottom";
  if (position === total) return "top";
  return "middle";
}

/**
 * Walks up through parents and down through children. Descends the single child
 * when a branch has exactly one; a fork ends the chain, because past a fork there
 * is no longer one line to show.
 */
export function stackChain(
  snapshot: StackSnapshot,
  branchName: string,
): StackChain | null {
  const byName = new Map(snapshot.branches.map((branch) => [branch.name, branch]));
  const start = byName.get(branchName);
  // Graphite also keeps metadata rows for branches it has seen but has not tracked.
  if (start === undefined || (start.parent === null && !start.isTrunk)) return null;

  const inCycle = new Set(snapshot.cycles.flat());

  const ancestors: StackBranch[] = [];
  const seenUp = new Set<string>([branchName]);
  let up = start.parent === null ? undefined : byName.get(start.parent);
  while (up !== undefined && !seenUp.has(up.name) && !inCycle.has(up.name)) {
    ancestors.unshift(up);
    seenUp.add(up.name);
    up = up.parent === null ? undefined : byName.get(up.parent);
  }

  const descendants: StackBranch[] = [];
  const seenDown = new Set<string>([branchName]);
  let down = start.children.length === 1 ? byName.get(start.children[0]) : undefined;
  while (down !== undefined && !seenDown.has(down.name) && !inCycle.has(down.name)) {
    descendants.push(down);
    seenDown.add(down.name);
    down = down.children.length === 1 ? byName.get(down.children[0]) : undefined;
  }

  const branches = [...ancestors, start, ...descendants];
  const position = ancestors.length + 1;
  // branches is root-first, so everything at or below the branch is the prefix.
  const atOrBelow = branches.slice(0, position);

  return {
    branches,
    position,
    total: branches.length,
    placement: placementOf(position, branches.length),
    needsRestack: atOrBelow.some((branch) => branch.needsRestack),
    isStale: branches.some((branch) => branch.isStale),
  };
}

/**
 * Everything growing out of `branchName` that the chain itself does not pass
 * through, flattened depth-first with the depth needed to indent it.
 *
 * `gt ls` draws these as extra columns joined by `┘`. Without them a stack looks
 * linear when it is not: in ~/Developer/outfitter/skillset the branch the chain
 * runs through carries five more branches nobody could see.
 */
export function stackOffshoots(
  snapshot: StackSnapshot,
  chainNames: ReadonlySet<string>,
  branchName: string,
): StackOffshoot[] {
  const byName = new Map(snapshot.branches.map((branch) => [branch.name, branch]));
  const inCycle = new Set(snapshot.cycles.flat());
  const seen = new Set<string>([branchName]);
  const out: StackOffshoot[] = [];

  // Post-order: a branch's descendants are listed before it, so every row sits
  // above the row it joins. That is the order `gt ls` prints, and it is what makes
  // a column readable — the node closing a column appears directly under the run
  // it closes.
  const walk = (name: string, column: number, parent: string | null): void => {
    const branch = byName.get(name);
    if (branch === undefined || seen.has(name) || inCycle.has(name)) return;
    seen.add(name);
    // The first child continues this column; each extra child opens the next one.
    branch.children.forEach((child, index) => walk(child, column + index, name));
    out.push({
      name,
      column,
      parent,
      needsRestack: branch.needsRestack,
      isStale: branch.isStale,
    });
  };

  const start = byName.get(branchName);
  if (start === undefined) return out;
  start.children
    .filter((child) => !chainNames.has(child))
    .forEach((child, index) => walk(child, 1 + index, null));
  return out;
}
