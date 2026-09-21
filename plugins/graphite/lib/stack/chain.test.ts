import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStack } from "./graph.ts";
import { stackChain, stackOffshoots } from "./chain.ts";
import type { BranchRecord } from "./metadata.ts";
import type { StackSnapshot } from "./types.ts";

/** A record whose revisions agree with git unless a test says otherwise. */
function record(
  name: string,
  parent: string | null,
  overrides: Partial<BranchRecord> = {},
): BranchRecord {
  return {
    name,
    parent,
    parentRevision: parent === null ? null : `sha-${parent}`,
    revision: `sha-${name}`,
    validation: parent === null ? "TRUNK" : "VALID",
    recordedChildren: null,
    ...overrides,
  };
}

function snapshot(records: readonly BranchRecord[]): StackSnapshot {
  const heads = new Map(records.map((r) => [r.name, `sha-${r.name}`]));
  const built = buildStack({ records, heads, trunk: "main" });
  return {
    gitCommonDir: "/fixture/.git",
    trunk: "main",
    schema: { migrations: [], unexpected: [], missing: [] },
    branches: built.branches,
    roots: built.roots,
    cycles: built.cycles,
    issues: built.issues,
  };
}

const linear = snapshot([
  record("main", null),
  record("a", "main"),
  record("b", "a"),
  record("c", "b"),
]);

describe("stackChain", () => {
  it("returns the whole line through the requested branch", () => {
    const chain = stackChain(linear, "b");
    assert.ok(chain);
    assert.deepEqual(
      chain.branches.map((branch) => branch.name),
      ["main", "a", "b", "c"],
    );
    assert.equal(chain.position, 3);
    assert.equal(chain.total, 4);
  });

  it("places trunk at the bottom and the tip at the top", () => {
    assert.equal(stackChain(linear, "main")?.placement, "bottom");
    assert.equal(stackChain(linear, "b")?.placement, "middle");
    assert.equal(stackChain(linear, "c")?.placement, "top");
  });

  it("stops at a fork, because past one there is no single line", () => {
    const forked = snapshot([
      record("main", null),
      record("a", "main"),
      record("b", "a"),
      record("c", "a"),
    ]);
    assert.deepEqual(
      stackChain(forked, "a")?.branches.map((branch) => branch.name),
      ["main", "a"],
    );
    assert.deepEqual(
      stackChain(forked, "b")?.branches.map((branch) => branch.name),
      ["main", "a", "b"],
    );
  });

  it("reports a restack needed below the branch, not above it", () => {
    // `a` sits on a main that has moved. Restacking it moves b and c too.
    const drifted = snapshot([
      record("main", null),
      record("a", "main", { parentRevision: "sha-main-old" }),
      record("b", "a"),
      record("c", "b"),
    ]);
    assert.equal(stackChain(drifted, "c")?.needsRestack, true);
    assert.equal(stackChain(drifted, "a")?.needsRestack, true);
    assert.equal(stackChain(drifted, "main")?.needsRestack, false);
  });

  it("surfaces a branch whose recorded head is behind git", () => {
    const stale = snapshot([
      record("main", null),
      record("a", "main", { revision: "sha-a-old" }),
    ]);
    assert.equal(stackChain(stale, "a")?.isStale, true);
    assert.equal(stackChain(linear, "a")?.isStale, false);
  });

  it("refuses to loop on a cycle", () => {
    const cyclic = snapshot([
      record("main", null),
      record("x", "y"),
      record("y", "x"),
    ]);
    const chain = stackChain(cyclic, "x");
    assert.ok(chain);
    assert.ok(chain.total <= 2);
  });

  it("lists offshoot descendants before the branch they join, as `gt ls` does", () => {
    const forked = snapshot([
      record("main", null),
      record("a", "main"),
      record("b", "a"),
      // A straight run off `a`: three branches, one column.
      record("x1", "a"),
      record("x2", "x1"),
      record("x3", "x2"),
      // A second line off `a`: the next column.
      record("y1", "a"),
      // A third off trunk.
      record("z1", "main"),
    ]);
    const chainNames = new Set(
      stackChain(forked, "b")!.branches.map((branch) => branch.name),
    );
    // A straight run stays in one column however long; only a fork opens the next.
    // Each branch is listed after its descendants, so it renders below them.
    assert.deepEqual(
      stackOffshoots(forked, chainNames, "a").map((o) => [o.name, o.column]),
      [
        ["x3", 1],
        ["x2", 1],
        ["x1", 1],
        ["y1", 2],
      ],
    );
    assert.deepEqual(
      stackOffshoots(forked, chainNames, "main").map((o) => o.name),
      ["z1"],
    );
  });

  it("returns null for a branch Graphite does not track", () => {
    assert.equal(stackChain(linear, "untracked"), null);
    const seenButUntracked = snapshot([
      record("main", null),
      record("x", null, { validation: "BAD_PARENT_NAME" }),
    ]);
    assert.equal(stackChain(seenButUntracked, "x"), null);
  });
});
