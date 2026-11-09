import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidGraceMinutes, retireGraceMs } from "./retire.ts";

test("turned off, worktrees are never retired on a timer", () => {
  assert.equal(retireGraceMs({ enabled: false, minutes: 30 }), null);
});

test("turned on, the grace period is the setting in milliseconds", () => {
  assert.equal(retireGraceMs({ enabled: true, minutes: 30 }), 1_800_000);
  assert.equal(retireGraceMs({ enabled: true, minutes: 0 }), 0);
  assert.equal(retireGraceMs({ enabled: true, minutes: 0.5 }), 30_000);
});

test("a grace period is a finite, non-negative number of minutes", () => {
  assert.equal(isValidGraceMinutes(0), true);
  assert.equal(isValidGraceMinutes(45), true);
  assert.equal(isValidGraceMinutes(-1), false);
  assert.equal(isValidGraceMinutes(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidGraceMinutes(Number.NaN), false);
});
