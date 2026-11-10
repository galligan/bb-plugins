import assert from "node:assert/strict";
import { test } from "node:test";

import { isUnder, slug, worktreePath } from "./paths.ts";

test("slug keeps readable names and flattens separators", () => {
  assert.equal(slug("skillset"), "skillset");
  assert.equal(slug("bb/fix-login-thr_ab12"), "bb-fix-login-thr_ab12");
  assert.equal(slug("My Project!"), "My-Project");
});

test("slug never yields a traversal or empty segment", () => {
  assert.equal(slug(".."), "unnamed");
  assert.equal(slug("../../etc"), "etc");
  assert.equal(slug("///"), "unnamed");
});

test("worktreePath nests the repo location, then one flattened branch segment", () => {
  assert.equal(
    worktreePath(
      "/home/u/.worktrees",
      ["gh", "outfitter-dev", "trails"],
      "bb/add-thing-thr_1",
    ),
    "/home/u/.worktrees/gh/outfitter-dev/trails/bb-add-thing-thr_1",
  );
});

test("isUnder accepts only strict descendants", () => {
  assert.equal(isUnder("/r/wt", "/r/wt/a/b"), true);
  assert.equal(isUnder("/r/wt", "/r/wt"), false);
  assert.equal(isUnder("/r/wt", "/r/wt-other/a"), false);
  assert.equal(isUnder("/r/wt", "/r/wt/../x"), false);
});
