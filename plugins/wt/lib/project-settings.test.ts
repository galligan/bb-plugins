import assert from "node:assert/strict";
import { test } from "node:test";
import {
  effectiveBranchSettings,
  projectSettingsSchema,
} from "./project-settings.ts";
const global = { prefixBranches: true, branchPrefix: "wt/" };
test("project fields override independently, including false and the empty prefix", () => {
  assert.deepEqual(effectiveBranchSettings(global, null), global);
  for (const patch of [
    { prefixBranches: false },
    { branchPrefix: "project/" },
    { prefixBranches: false, branchPrefix: "" },
    { branchPrefix: "" },
  ]) {
    const row = projectSettingsSchema.parse({ version: 1, ...patch });
    assert.deepEqual(effectiveBranchSettings(global, row), {
      ...global,
      ...patch,
    });
  }
  assert.deepEqual(
    effectiveBranchSettings(
      global,
      projectSettingsSchema.parse({ version: 1, branchPrefix: null }),
    ),
    global,
  );
});
test("schema strips unknown keys, rejects wrong versions and bad prefixes", () => {
  assert.deepEqual(projectSettingsSchema.parse({ version: 1, future: true }), {
    version: 1,
  });
  assert.equal(projectSettingsSchema.safeParse({ version: 2 }).success, false);
  assert.equal(
    projectSettingsSchema.safeParse({ version: 1, branchPrefix: "../bad" })
      .success,
    false,
  );
});
