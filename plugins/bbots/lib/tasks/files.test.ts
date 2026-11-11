import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
  link,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../../host.ts";

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), "bbots-tasks-file-"));
  const host = experimental_createHostEntryHarness(entry);
  const botId = `bot_${randomUUID()}`;
  const { path } = await host.experimental_call("prepare", { botId, base });
  t.after(async () => {
    await host.experimental_dispose();
    await rm(base, { recursive: true, force: true });
  });
  const input = { botId, path };
  const requestId = randomUUID();
  return {
    host,
    input,
    requestId,
    path,
    file: join(path, "tasks.md"),
    init: () =>
      host.experimental_call("tasksInitialize", { ...input, requestId }),
  };
}

test("real host initializes the exact Markdown intent idempotently without adopting an occupied file", async (t) => {
  const f = await fixture(t);
  const first = await f.init();
  assert.equal(first.path, f.file);
  assert.match(first.markdown, new RegExp(f.requestId));
  assert.deepEqual(await f.init(), first);
  await assert.rejects(
    f.host.experimental_call("tasksInitialize", {
      ...f.input,
      requestId: randomUUID(),
    }),
    /differs.*intent/,
  );
  assert.equal(await readFile(f.file, "utf8"), first.markdown);
  await writeFile(f.file, "User's existing tasks");
  await assert.rejects(f.init(), /no file was overwritten/);
  assert.equal(await readFile(f.file, "utf8"), "User's existing tasks");
});

test("hash-checked host edits retain arbitrary Markdown verbatim and refuse stale writes", async (t) => {
  const f = await fixture(t);
  const first = await f.init();
  const markdown =
    "# My format\n\n- [ ] Keep evidence\nCustom prose and Unicode: é\n";
  const updated = await f.host.experimental_call("tasksWrite", {
    ...f.input,
    expectedHash: first.hash,
    markdown,
  });
  assert.equal(updated.markdown, markdown);
  assert.notEqual(updated.hash, first.hash);
  assert.deepEqual(
    await f.host.experimental_call("tasksRead", f.input),
    updated,
  );
  await assert.rejects(
    f.host.experimental_call("tasksWrite", {
      ...f.input,
      expectedHash: first.hash,
      markdown: "Stale replacement",
    }),
    /changed.*nothing was overwritten/,
  );
  assert.equal(await readFile(f.file, "utf8"), markdown);
  assert.equal("taskCount" in updated, false);
  assert.deepEqual((await readdir(f.path)).sort(), [
    ".bbots-home.json",
    "tasks.md",
  ]);
});

test("concurrent host writes serialize with an exclusive lock and never overwrite the winner", async (t) => {
  const f = await fixture(t);
  const initial = await f.init();
  const outcomes = await Promise.allSettled(
    ["First", "Second"].map((markdown) =>
      f.host.experimental_call("tasksWrite", {
        ...f.input,
        expectedHash: initial.hash,
        markdown,
      }),
    ),
  );
  const successful = outcomes.filter((value) => value.status === "fulfilled");
  assert.equal(successful.length, 1);
  const winner = successful[0]!;
  if (winner.status !== "fulfilled")
    throw new Error("Missing successful receipt");
  assert.equal(await readFile(f.file, "utf8"), winner.value.markdown);
  assert.deepEqual((await readdir(f.path)).sort(), [
    ".bbots-home.json",
    "tasks.md",
  ]);
});

test("a UTF-8 BOM survives an unchanged Markdown read/write round trip byte for byte", async (t) => {
  const f = await fixture(t);
  await f.init();
  const markdown = "\uFEFF# Tasks with a byte-order mark\n";
  const bytes = Buffer.from(markdown, "utf8");
  await writeFile(f.file, bytes);
  const read = await f.host.experimental_call("tasksRead", f.input);
  assert.equal(read.markdown, markdown);
  const written = await f.host.experimental_call("tasksWrite", {
    ...f.input,
    expectedHash: read.hash,
    markdown: read.markdown,
  });
  assert.deepEqual(await readFile(f.file), bytes);
  assert.equal(written.hash, read.hash);
});

test("a partial initialization file is preserved for manual inspection instead of overwritten on resume", async (t) => {
  const f = await fixture(t);
  const first = await f.init();
  const partial = first.markdown.slice(0, 20);
  await writeFile(f.file, partial);
  await assert.rejects(f.init(), /differs.*intent.*no file was overwritten/);
  assert.equal(await readFile(f.file, "utf8"), partial);
});

test("symlinked, multiply-linked and oversized task files are refused with the original content retained", async (t) => {
  const f = await fixture(t);
  const other = join(f.path, "preserve.md");
  await writeFile(other, "Preserve this content");
  await symlink(other, f.file);
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /regular.*unlinked/,
  );
  await assert.rejects(f.init(), /regular.*unlinked/);
  assert.equal(await readFile(other, "utf8"), "Preserve this content");
  await rm(f.file);
  await link(other, f.file);
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /regular.*unlinked/,
  );
  await rm(f.file);
  await writeFile(f.file, "x".repeat(65537));
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /65,536/,
  );
  assert.equal((await readFile(f.file)).length, 65537);
});

test("missing home/file and interrupted lock are actionable conflicts, not permission to recreate or steal", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /missing.*Restore/,
  );
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
  const initial = await f.init();
  const lock = join(f.path, ".bbots-tasks.lock");
  await writeFile(lock, "Preserve existing lock");
  await assert.rejects(
    f.host.experimental_call("tasksWrite", {
      ...f.input,
      expectedHash: initial.hash,
      markdown: "No overwrite",
    }),
    /interrupted lock.*not steal/,
  );
  assert.equal(await readFile(lock, "utf8"), "Preserve existing lock");
  assert.equal(await readFile(f.file, "utf8"), initial.markdown);
  await rm(f.path, { recursive: true });
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /Original bot home.*Restore/,
  );
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
});

test("byte bounds, malformed hashes, invalid UTF-8 and cancellation refuse edits without changing content", async (t) => {
  const f = await fixture(t);
  const first = await f.init();
  await assert.rejects(
    f.host.experimental_call("tasksWrite", {
      ...f.input,
      expectedHash: first.hash,
      markdown: "é".repeat(40000),
    }),
    /65,536-byte/,
  );
  await assert.rejects(
    f.host.experimental_call("tasksWrite", {
      ...f.input,
      expectedHash: "not-a-hash",
      markdown: "No",
    }),
  );
  const controller = new AbortController();
  controller.abort(new Error("Canceled by caller"));
  await assert.rejects(
    f.host.experimental_call(
      "tasksWrite",
      { ...f.input, expectedHash: first.hash, markdown: "No" },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
  assert.equal(await readFile(f.file, "utf8"), first.markdown);
  await writeFile(f.file, Buffer.from([0xff, 0xfe]));
  await assert.rejects(
    f.host.experimental_call("tasksRead", f.input),
    /encoded data|encoding/,
  );
  assert.deepEqual(await readFile(f.file), Buffer.from([0xff, 0xfe]));
});
