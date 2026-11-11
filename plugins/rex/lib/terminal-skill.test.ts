import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Exercise the shipped example in real shells without touching Rex or BB.
// This does not prove interactive submission, prompts, or agent adoption.
const skill = readFileSync(
  new URL("../skills/rex-thread-terminal/SKILL.md", import.meta.url),
  "utf8",
);

for (const [shell, flags] of [
  ["bash", ["--noprofile", "--norc"]],
  ["zsh", ["-f"]],
  ["fish", ["--no-config"]],
] as const) {
  test(`the terminal skill's quoted loop executes in ${shell}`, (t) => {
    const probe = spawnSync(shell, [...flags, "-c", "exit 0"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (probe.error && "code" in probe.error && probe.error.code === "ENOENT") {
      t.skip(`${shell} is not installed; its shell behavior is unverified`);
      return;
    }
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr);

    const example = skill.match(/<<'EOF'\n\s*(sh -c [^\n]+)\n\s*EOF/);
    assert.ok(example, "the skill must contain its quoted heredoc example");
    const result = spawnSync(shell, [...flags, "-c", example[1]!], {
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "it's 1\nit's 2\nit's 3\n");
    assert.equal(result.stderr, "");
  });

  test(`the terminal skill's standalone export persists in ${shell}`, (t) => {
    const result = spawnSync(
      shell,
      [
        ...flags,
        "-c",
        "export REX_SKILL_TEST=exported\nsh -c 'printenv REX_SKILL_TEST'",
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (
      result.error &&
      "code" in result.error &&
      result.error.code === "ENOENT"
    ) {
      t.skip(`${shell} is not installed; its shell behavior is unverified`);
      return;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "exported\n");
    assert.equal(result.stderr, "");
  });
}
