import assert from "node:assert/strict";
import { test } from "node:test";

import { readBase, toInputs } from "./base-input.ts";

test("readBase accepts only a non-empty string base", () => {
  assert.equal(readBase({ base: "origin/main" }), "origin/main");
  assert.equal(readBase({}), null);
  assert.equal(readBase(null), null);
  assert.equal(readBase({ base: "" }), null);
  assert.equal(readBase({ base: 3 }), null);
  assert.equal(readBase(["origin/main"]), null);
});

test("toInputs round-trips through readBase", () => {
  assert.deepEqual(toInputs("feat/x"), { base: "feat/x" });
  assert.deepEqual(toInputs(null), {});
  assert.equal(readBase(toInputs("feat/x")), "feat/x");
});
