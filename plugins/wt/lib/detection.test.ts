import assert from "node:assert/strict";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "./fixture.ts";
import { detectSetupPlan } from "./detection.ts";

test("setup detection covers none, Codex, bb hooks, malformed TOML and shared names only", async (t) => {
  const f = await fixture(t, {
    ".gitignore": ".env\n",
    ".worktreeinclude": ".env\n",
  });
  const secret = "SECRET_VALUE_MUST_NOT_LEAVE_HOST";
  await writeFile(join(f.source, ".env"), secret);
  const none = await detectSetupPlan(f.source);
  assert.equal(none.source, "none");
  assert.deepEqual(none.sharedFiles, { patternFile: true, files: [".env"] });
  assert.equal(JSON.stringify(none).includes(secret), false);
  const file = join(f.source, ".codex/environments/environment.toml");
  await mkdir(join(f.source, ".codex/environments"), { recursive: true });
  await writeFile(
    file,
    '[setup]\nscript = "echo setup"\n[cleanup]\nscript = "echo cleanup"\n',
  );
  assert.equal((await detectSetupPlan(f.source)).setup, "echo setup");
  await writeFile(file, '[setup]\nscript = "' + "x".repeat(20000) + '"');
  const capped = await detectSetupPlan(f.source);
  assert.ok(Buffer.byteLength(capped.setup ?? "") <= 16384);
  assert.match(capped.error ?? "", /truncated/u);
  await writeFile(file, "[broken");
  assert.match(
    (await detectSetupPlan(f.source)).error ?? "",
    /Could not read/u,
  );
  await writeFile(join(f.source, ".bb-env-teardown.sh"), "echo core");
  const hook = await detectSetupPlan(f.source);
  assert.equal(hook.source, "bb-hook");
  assert.deepEqual(hook.hooks, { setup: false, teardown: true });
  assert.equal(hook.setup, null);
});

test("an ignored script config is never returned", async (t) => {
  const f = await fixture(t, { ".gitignore": ".codex/\n" });
  await mkdir(join(f.source, ".codex/environments"), { recursive: true });
  await writeFile(
    join(f.source, ".codex/environments/environment.toml"),
    '[setup]\nscript = "PRIVATE_SCRIPT"',
  );
  const plan = await detectSetupPlan(f.source);
  assert.equal(plan.setup, null);
  assert.equal(JSON.stringify(plan).includes("PRIVATE_SCRIPT"), false);
  assert.match(plan.error ?? "", /ignored/u);
});

test("a symlinked config cannot disclose an ignored file", async (t) => {
  const f = await fixture(t, { ".gitignore": ".env\n" });
  await writeFile(join(f.source, ".env"), '[setup]\nscript = "SECRET_SCRIPT"');
  await mkdir(join(f.source, ".codex/environments"), { recursive: true });
  await symlink(
    join(f.source, ".env"),
    join(f.source, ".codex/environments/environment.toml"),
  );
  const plan = await detectSetupPlan(f.source);
  assert.equal(plan.setup, null);
  assert.equal(JSON.stringify(plan).includes("SECRET_SCRIPT"), false);
  assert.match(plan.error ?? "", /symlink/u);
});
