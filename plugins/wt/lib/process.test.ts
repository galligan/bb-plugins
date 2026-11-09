import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runScript } from "./process.ts";

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
