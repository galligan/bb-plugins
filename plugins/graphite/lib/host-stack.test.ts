import assert from "node:assert/strict";
import { it } from "node:test";

import { summarizeStack } from "./host-stack.ts";
import type { StackSnapshot } from "./stack/types.ts";

it("reports Graphite migration changes in the returned stack", () => {
  const snapshot: StackSnapshot = {
    gitCommonDir: "/tmp/repo/.git",
    trunk: "main",
    schema: {
      migrations: ["new_migration"],
      unexpected: ["new_migration"],
      missing: [],
    },
    branches: [
      {
        name: "main",
        parent: null,
        children: [],
        isTrunk: true,
        recordedRevision: "a",
        actualHead: "a",
        isStale: false,
        needsRestack: false,
        validation: "TRUNK",
      },
    ],
    roots: ["main"],
    cycles: [],
    issues: [
      { kind: "schema_changed", unexpected: ["new_migration"], missing: [] },
      { kind: "missing_parent", branch: "feature", parent: "gone" },
    ],
  };
  const result = summarizeStack(snapshot, "main");
  assert.equal(result.outcome, "stacked");
  if (result.outcome === "stacked") {
    assert.match(result.warnings[0], /new_migration/);
    assert.match(result.warnings[1], /missing parent \(feature\)/);
  }
});
