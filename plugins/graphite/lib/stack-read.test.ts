import assert from "node:assert/strict";
import { test } from "node:test";
import { updateStackRead } from "./stack-read.ts";
import type { CurrentStack } from "./current-stack.ts";

const stack: CurrentStack = {
  outcome: "stacked",
  branch: "feature",
  position: 2,
  total: 2,
  placement: "top",
  needsRestack: false,
  isStale: false,
  workingTree: "clean",
  warnings: [],
  branches: [],
};
test("transport and structured Git/host failures preserve loaded lineage", () => {
  const loaded = updateStackRead(undefined, stack);
  for (const failure of [
    null,
    { outcome: "unavailable", reason: "Git status unavailable" } as const,
    {
      outcome: "unavailable",
      reason: "workspace host is unavailable",
    } as const,
  ]) {
    assert.deepEqual(updateStackRead(loaded, failure), { stack, error: true });
    assert.deepEqual(updateStackRead(undefined, failure), {
      stack: null,
      error: true,
    });
  }
});
test("confirmed absent stacks clear cached lineage and successful reads clear errors", () => {
  const failed = { stack, error: true };
  const absent = {
    outcome: "none",
    reason: "branch is not tracked by Graphite",
  } as const;
  assert.deepEqual(updateStackRead(failed, absent), {
    stack: absent,
    error: false,
  });
  assert.deepEqual(updateStackRead(failed, stack), { stack, error: false });
});
