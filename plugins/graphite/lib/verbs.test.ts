import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blocksWrite } from "./verbs.ts";

describe("blocksWrite", () => {
  it("refuses the states where a rebase can lose work", () => {
    assert.equal(blocksWrite("dirty_uncommitted"), true);
    assert.equal(blocksWrite("committed_unmerged"), true);
    assert.equal(blocksWrite("dirty_and_committed_unmerged"), true);
  });

  it("allows a clean tree", () => {
    assert.equal(blocksWrite("clean"), false);
  });

  it("allows untracked files", () => {
    // A rebase does not touch them, and git aborts on its own if an incoming
    // commit would overwrite one. Refusing here would only teach --force.
    assert.equal(blocksWrite("untracked"), false);
  });

  it("refuses a state it does not recognise, so the guard fails closed", () => {
    assert.equal(blocksWrite("some_future_state"), true);
  });
});
