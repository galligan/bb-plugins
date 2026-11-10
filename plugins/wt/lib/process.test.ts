import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runScript } from "./process.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function run(script: string, overrides: { timeoutMs?: number } = {}) {
  const lines: string[] = [];
  return runScript({
    script,
    cwd: tmpdir(),
    env: process.env,
    timeoutMs: overrides.timeoutMs ?? 10_000,
    killGraceMs: 200,
    onOutput: (line) => lines.push(line),
  }).then((result) => ({ result, lines }));
}

test("a script that ignores SIGTERM is killed after the grace period", async () => {
  const started = Date.now();
  const { result } = await run("trap '' TERM; while :; do sleep 0.05; done", {
    timeoutMs: 100,
  });
  assert.deepEqual(result, { ok: false, reason: "timed out after 0s" });
  assert.ok(Date.now() - started < 4000);
});

test("one enormous line is cut, not buffered", async () => {
  const { result, lines } = await run("head -c 3000000 /dev/zero | tr '\\0' x");
  assert.deepEqual(result, { ok: true });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.length, 4096);
});

test("output beyond the line limit is dropped with one notice", async () => {
  const { result, lines } = await run("seq 1 6000");
  assert.deepEqual(result, { ok: true });
  assert.equal(lines.length, 5001);
  assert.equal(lines[4999], "5000");
  assert.match(lines[5000] ?? "", /truncated after 5000 lines/u);
});

test("a child that outlives the shell and ignores SIGTERM is still killed", async () => {
  const { result, lines } = await run(
    "(trap '' TERM; exec sleep 30 >/dev/null 2>&1) & echo $!; wait",
    { timeoutMs: 150 },
  );
  assert.equal(result.ok, false);
  const pid = Number.parseInt(lines[0] ?? "", 10);
  assert.ok(pid > 0);
  // The killed child is briefly a zombie until its new parent reaps it, and a
  // zombie still answers signal 0. Left alone it would sleep for 30 seconds.
  const deadline = Date.now() + 2000;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(isAlive(pid), false);
});
