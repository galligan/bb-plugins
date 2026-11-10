import assert from "node:assert/strict";
import { test } from "node:test";
import { stackHeaderAction } from "./header-action.ts";
import type { CurrentStack } from "./current-stack.ts";

const stack: Extract<CurrentStack, { outcome: "stacked" }> = {
  outcome: "stacked",
  branch: "feature",
  position: 2,
  total: 3,
  placement: "middle",
  needsRestack: false,
  isStale: false,
  workingTree: "clean",
  warnings: [],
  branches: [],
};
test("header hides absent stacks and one-branch results", () => {
  for (const result of [
    null,
    undefined,
    { outcome: "none", reason: "untracked" } as const,
    { ...stack, total: 1 },
  ]) {
    assert.equal(
      stackHeaderAction(result, () => assert.fail("hidden action ran")),
      null,
    );
  }
});
test("header carries count, placement, status precedence and panel action", () => {
  let opened = 0;
  const action = stackHeaderAction(stack, () => {
    opened++;
  });
  assert.equal(action?.label, "Graphite 2/3");
  assert.equal(action?.icon, "graphite-stack-middle");
  assert.equal(action?.detail, undefined);
  action?.run({ requestRename: () => assert.fail() });
  assert.equal(opened, 1);
  assert.equal(
    stackHeaderAction({ ...stack, isStale: true }, () => {})?.label,
    "Graphite 2/3 · Drifted",
  );
  assert.equal(
    stackHeaderAction({ ...stack, isStale: true, needsRestack: true }, () => {})
      ?.label,
    "Graphite 2/3 · Needs restack",
  );
  assert.equal(
    stackHeaderAction(
      { ...stack, needsRestack: true, warnings: ["schema changed"] },
      () => {},
    )?.label,
    "Graphite 2/3 · Metadata changed",
  );
});

test("a failed refresh retains the loaded action and labels the stale read", () => {
  const action = stackHeaderAction(stack, () => {}, true);
  assert.equal(action?.label, "Graphite 2/3 · Refresh failed");
  assert.equal(
    stackHeaderAction(null, () => {}, true),
    null,
  );
});

test("a 1/1 spine keeps its header action hidden even when it has offshoots", () => {
  const fork: CurrentStack = {
    ...stack,
    position: 1,
    total: 1,
    placement: "bottom",
    branches: [
      {
        name: "main",
        isCurrent: true,
        needsRestack: false,
        isStale: false,
        threads: [],
        offshoots: [
          {
            name: "child",
            column: 1,
            parent: null,
            needsRestack: false,
            isStale: false,
            threads: [],
          },
        ],
      },
    ],
  };
  assert.equal(
    stackHeaderAction(fork, () => assert.fail("hidden action ran")),
    null,
  );
});
