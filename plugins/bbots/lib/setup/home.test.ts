import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  lstat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../../host.ts";

const botId = "bot_11111111-1111-4111-8111-111111111111";
test("host preflight uses native path rules, rejects repository aliases, and creates no directories", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "bbots-validate-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const host = experimental_createHostEntryHarness(entry);
  t.after(() => host.experimental_dispose());
  const candidate = join(base, "new", "nested");
  assert.deepEqual(
    await host.experimental_call("validateBase", { base: candidate }),
    { path: join(await realpath(base), "new", "nested") },
  );
  await assert.rejects(lstat(join(base, "new")), { code: "ENOENT" });
  await assert.rejects(
    host.experimental_call("validateBase", {
      base: process.platform === "win32" ? "relative" : "C:\\bots",
    }),
    /absolute home base/,
  );
  const repo = join(base, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  await symlink(repo, join(base, "alias"));
  await assert.rejects(
    host.experimental_call("validateBase", {
      base: join(base, "alias", "new"),
    }),
    /outside Git/,
  );
  await assert.rejects(lstat(join(repo, "new")), { code: "ENOENT" });
});

test("real host entry prepares a stable home once and inspect never recreates a missing home", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "bbots-home-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const host = experimental_createHostEntryHarness(entry);
  t.after(() => host.experimental_dispose());
  const first = await host.experimental_call("prepare", { botId, base });
  assert.equal(first.status, "created");
  await writeFile(join(first.path, "notes.md"), "Keep this artifact");
  const second = await host.experimental_call("prepare", { botId, base });
  assert.equal(second.path, first.path);
  assert.equal(second.status, "present");
  assert.equal(
    await readFile(join(first.path, "notes.md"), "utf8"),
    "Keep this artifact",
  );
  await rm(first.path, { recursive: true });
  assert.deepEqual(
    await host.experimental_call("inspect", { botId, path: first.path }),
    { status: "missing" },
  );
  await assert.rejects(readFile(join(first.path, ".bbots-home.json")));
});

test("host refuses occupied, symlinked or repository homes and preserves content", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "bbots-conflict-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const host = experimental_createHostEntryHarness(entry);
  t.after(() => host.experimental_dispose());
  const target = join(base, botId);
  await mkdir(target);
  await writeFile(join(target, "draft"), "Original");
  await assert.rejects(
    host.experimental_call("prepare", { botId, base }),
    /matching Bots marker/,
  );
  assert.equal(await readFile(join(target, "draft"), "utf8"), "Original");
  await rm(target, { recursive: true });
  const other = join(base, "other");
  await mkdir(other);
  await symlink(other, target);
  assert.deepEqual(
    await host.experimental_call("inspect", { botId, path: target }),
    { status: "conflict" },
  );
  await assert.rejects(host.experimental_call("prepare", { botId, base }));
  const repo = join(base, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  await assert.rejects(
    host.experimental_call("prepare", { botId, base: join(repo, "homes") }),
    /outside Git/,
  );
  await assert.rejects(
    readFile(join(repo, "homes", botId, ".bbots-home.json")),
  );
});

test("host schema/cancellation/disposal reject invalid work without creating a home", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "bbots-abort-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const host = experimental_createHostEntryHarness(entry);
  await assert.rejects(
    host.experimental_call("prepare", { botId: "../../escape", base }),
  );
  await assert.rejects(
    host.experimental_call("prepare", { botId, base: "relative" }),
  );
  await assert.rejects(
    host.experimental_call(
      "prepare",
      { botId, base },
      { signal: AbortSignal.abort() },
    ),
  );
  await host.experimental_dispose();
  await assert.rejects(host.experimental_call("prepare", { botId, base }));
});
