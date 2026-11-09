import assert from "node:assert/strict";
import { test } from "node:test";

import { age, renderWorktree } from "./render.ts";

const NOW = 1_800_000_000_000;

test("age is coarse and readable", () => {
  assert.equal(age(null, NOW), "unknown");
  assert.equal(age(NOW - 20_000, NOW), "just now");
  assert.equal(age(NOW - 5 * 60_000, NOW), "5m ago");
  assert.equal(age(NOW - 5 * 3_600_000, NOW), "5h ago");
  assert.equal(age(NOW - 72 * 3_600_000, NOW), "3d ago");
});

test("an unsaved worktree lists its reasons", () => {
  const text = renderWorktree(
    {
      status: "present",
      pathKey: "k",
      inspection: {
        path: "/w/a",
        branch: "feat/x",
        changedFiles: 1,
        untrackedFiles: 0,
        editedSharedFiles: [],
        operation: null,
        unreferencedHead: false,
        unsavedSubmodules: [],
        branchState: "local",
        unpushedCommits: 2,
        lastActivity: NOW - 3_600_000,
        safeToRemove: false,
        reasons: ["1 tracked file with uncommitted changes"],
      },
    },
    NOW,
  );
  assert.equal(
    text,
    [
      "UNSAVED  /w/a",
      "         branch feat/x: local only (2 unpushed); last activity 1h ago",
      "         - 1 tracked file with uncommitted changes",
    ].join("\n"),
  );
});

test("a missing folder is called out", () => {
  assert.match(
    renderWorktree({ status: "missing", pathKey: "k", path: "/w/gone" }, NOW),
    /^GONE {5}\/w\/gone/u,
  );
});
