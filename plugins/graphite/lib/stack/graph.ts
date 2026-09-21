// Joins Graphite's recorded metadata with the repository's real branch heads.
//
// Pure: no filesystem, no processes. Everything here is decided from its arguments.

import type { BranchRecord } from "./metadata.ts";
import type { StackBranch, StackIssue } from "./types.ts";

export interface BuildStackInput {
  readonly records: readonly BranchRecord[];
  /** Branch name to the commit git reports for it now. */
  readonly heads: ReadonlyMap<string, string>;
  readonly trunk: string | null;
}

export interface BuildStackResult {
  readonly branches: readonly StackBranch[];
  readonly roots: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly issues: readonly StackIssue[];
}

const GRAY = 1;
const BLACK = 2;

/**
 * Walks every parent chain once and returns the chains that close on themselves.
 * A cycle is reported, never followed.
 */
function findCycles(
  names: readonly string[],
  parentOf: ReadonlyMap<string, string>,
): string[][] {
  const state = new Map<string, number>();
  const cycles: string[][] = [];

  for (const start of names) {
    if (state.get(start) !== undefined) continue;

    const path: string[] = [];
    const positionInPath = new Map<string, number>();
    let current: string | undefined = start;

    while (current !== undefined) {
      const seen = state.get(current);
      if (seen === BLACK) break;
      if (seen === GRAY) {
        const from = positionInPath.get(current);
        if (from !== undefined) cycles.push(path.slice(from));
        break;
      }
      state.set(current, GRAY);
      positionInPath.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }

    for (const name of path) state.set(name, BLACK);
  }

  return cycles;
}

export function buildStack(input: BuildStackInput): BuildStackResult {
  const sorted = [...input.records].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const issues: StackIssue[] = [];

  // Graphite keeps a row after its branch is gone — 132 of 157 rows in
  // ~/Developer/outfitter/skillset. Those are stale metadata, not branches: left in
  // the graph they inflate every count (trunk showed 48 children where `gt ls` shows
  // 5). They are reported, not carried.
  const records: BranchRecord[] = [];
  for (const record of sorted) {
    if (input.heads.has(record.name)) records.push(record);
    else issues.push({ kind: "missing_branch", branch: record.name });
  }

  const byName = new Map(records.map((record) => [record.name, record]));

  // Edges come from parent_branch_name only. The `children` column disagrees with it
  // in real repositories; see docs/agents/graphite.md.
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const record of records) {
    if (record.parent === null) continue;
    if (!byName.has(record.parent)) {
      issues.push({
        kind: "missing_parent",
        branch: record.name,
        parent: record.parent,
      });
      continue;
    }
    parentOf.set(record.name, record.parent);
    const siblings = childrenOf.get(record.parent);
    if (siblings === undefined) childrenOf.set(record.parent, [record.name]);
    else siblings.push(record.name);
  }

  const names = records.map((record) => record.name);
  const cycles = findCycles(names, parentOf);
  for (const cycle of cycles) issues.push({ kind: "cycle", branches: cycle });

  const branches: StackBranch[] = [];
  const roots: string[] = [];
  for (const record of records) {
    const children = [...(childrenOf.get(record.name) ?? [])].sort();
    const actualHead = input.heads.get(record.name) ?? null;

    if (record.recordedChildren !== null) {
      const recorded = [...record.recordedChildren].sort();
      if (JSON.stringify(recorded) !== JSON.stringify(children)) {
        issues.push({
          kind: "children_mismatch",
          branch: record.name,
          recorded,
          derived: children,
        });
      }
    }

    const parentHead =
      record.parent === null ? null : (input.heads.get(record.parent) ?? null);

    branches.push({
      name: record.name,
      parent: record.parent,
      children,
      isTrunk: input.trunk !== null && record.name === input.trunk,
      recordedRevision: record.revision,
      actualHead,
      isStale:
        record.revision !== null &&
        actualHead !== null &&
        record.revision !== actualHead,
      needsRestack:
        record.parentRevision !== null &&
        parentHead !== null &&
        record.parentRevision !== parentHead,
      validation: record.validation,
    });

    if (!parentOf.has(record.name)) roots.push(record.name);
  }

  return { branches, roots, cycles, issues };
}
