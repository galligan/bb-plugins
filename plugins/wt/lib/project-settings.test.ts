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

test("script overrides validate custom text by UTF-8 bytes and retain older rows", () => {
  const row = (script: string) => ({
    version: 1,
    scripts: {
      setup: { mode: "custom", script },
      cleanup: { mode: "detected", script: null },
    },
  });
  assert.equal(projectSettingsSchema.safeParse(row("")).success, false);
  assert.equal(projectSettingsSchema.safeParse(row("  \n")).success, false);
  assert.equal(
    projectSettingsSchema.safeParse(row("x".repeat(16385))).success,
    false,
  );
  assert.equal(
    projectSettingsSchema.safeParse(row("😀".repeat(5000))).success,
    false,
  );
  assert.equal(
    projectSettingsSchema.safeParse(row("echo ready")).success,
    true,
  );
  assert.deepEqual(
    projectSettingsSchema.parse({ version: 1, branchPrefix: "p/" }),
    { version: 1, branchPrefix: "p/" },
  );
});

test("Off and Detected discard invalid custom drafts so they can be saved", () => {
  for (const mode of ["off", "detected"]) {
    const parsed = projectSettingsSchema.parse({
      version: 1,
      scripts: {
        setup: { mode, script: "x".repeat(17000) },
        cleanup: { mode: "detected", script: "" },
      },
    });
    assert.equal(parsed.scripts?.setup.script, null);
    assert.equal(parsed.scripts?.cleanup.script, null);
  }
});
