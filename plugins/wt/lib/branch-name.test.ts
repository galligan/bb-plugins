import assert from "node:assert/strict";
import { test } from "node:test";

import { branchName, isValidBranchPrefix } from "./branch-name.ts";

const name = (overrides: {
  suggested?: string;
  bbPrefix?: string;
  pluginPrefix?: string;
  enabled?: boolean;
}) =>
  branchName({
    suggested: "fix-login-thr_ab12",
    bbPrefix: "",
    pluginPrefix: "",
    enabled: true,
    ...overrides,
  });

test("with no prefix set anywhere, the branch gets bb/", () => {
  assert.equal(name({}), "bb/fix-login-thr_ab12");
});

test("bb's own prefix is kept, not doubled", () => {
  assert.equal(
    name({ suggested: "mg/wt-fix-login-thr_ab12", bbPrefix: "mg/wt-" }),
    "mg/wt-fix-login-thr_ab12",
  );
});

test("the plugin's prefix replaces bb's", () => {
  assert.equal(
    name({
      suggested: "mg/wt-fix-login-thr_ab12",
      bbPrefix: "mg/wt-",
      pluginPrefix: "wt/",
    }),
    "wt/fix-login-thr_ab12",
  );
  assert.equal(name({ pluginPrefix: "wt/" }), "wt/fix-login-thr_ab12");
});

test("turned off, bb's suggestion is used as it is", () => {
  assert.equal(name({ enabled: false }), "fix-login-thr_ab12");
  assert.equal(
    name({ enabled: false, pluginPrefix: "wt/" }),
    "fix-login-thr_ab12",
  );
  assert.equal(
    name({ enabled: false, suggested: "mg/x-thr_1", bbPrefix: "mg/" }),
    "mg/x-thr_1",
  );
});

test("prefix validation accepts path-like prefixes and rejects unsafe ones", () => {
  for (const good of ["", "bb/", "mg/wt-", "team.x/", "a_b/"]) {
    assert.equal(isValidBranchPrefix(good), true, good);
  }
  for (const bad of [
    "/x",
    "-x",
    "a..b/",
    "a//b",
    ".hidden/",
    "a b/",
    "x~/",
    "a/.b/",
  ]) {
    assert.equal(isValidBranchPrefix(bad), false, bad);
  }
  assert.equal(isValidBranchPrefix("x".repeat(65)), false);
});
