import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lintWorkflows } from "./lint-workflows.mjs";

const version = readFileSync(
  new URL("../.actionlint-version", import.meta.url),
  "utf8",
).trim();

function fixture({
  probe = { status: 0, stdout: `${version}\nbuild metadata` },
  files = {
    status: 0,
    stdout: ".github/workflows/a workflow.yml\0.github/workflows/b.yaml\0",
  },
  result = { status: 0 },
} = {}) {
  const calls = [];
  const lines = [];
  const code = lintWorkflows({
    version,
    cwd: "/repo",
    log: (line) => lines.push(line),
    run: (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === "-version") return probe;
      if (command === "git") return files;
      return result;
    },
  });
  return { code, calls, output: lines.join("\n") };
}

test("lints only tracked YAML paths with stable optional-analyzer settings", () => {
  const f = fixture();
  assert.equal(f.code, 0);
  assert.deepEqual(f.calls[1].args, [
    "ls-files",
    "-z",
    "--",
    ":(glob).github/workflows/*.yml",
    ":(glob).github/workflows/*.yaml",
  ]);
  assert.deepEqual(f.calls[2].args, [
    "-shellcheck=",
    "-pyflakes=",
    ".github/workflows/a workflow.yml",
    ".github/workflows/b.yaml",
  ]);
  assert.equal(f.calls[2].options.cwd, "/repo");
});

for (const probe of [
  { status: 0, stdout: "0.0.0\n" },
  { status: null, error: new Error("ENOENT") },
]) {
  test("missing or wrong actionlint fails with installation guidance", () => {
    const f = fixture({ probe });
    assert.equal(f.code, 1);
    assert.equal(f.calls.length, 1);
    assert.match(f.output, /Install the pinned version on PATH/);
  });
}

test("file discovery and lint failures propagate", () => {
  assert.equal(
    fixture({ files: { status: 128, stderr: "not a repository" } }).code,
    128,
  );
  assert.equal(fixture({ files: { status: 0, stdout: "" } }).code, 1);
  assert.equal(fixture({ result: { status: 2 } }).code, 2);
});

test("real actionlint accepts a tracked workflow and rejects an invalid expression", () => {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-lint-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", cwd]).status, 0);
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    const path = join(cwd, ".github/workflows/ci.yml");
    const workflow =
      "name: Fixture\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n";
    writeFileSync(path, workflow);
    assert.equal(
      spawnSync("git", ["add", ".github/workflows/ci.yml"], { cwd }).status,
      0,
    );
    // An ignored/untracked reference workflow must not widen the lint boundary.
    writeFileSync(
      join(cwd, ".github/workflows/untracked.yml"),
      "not a workflow",
    );
    const logs = [];
    const run = (command, args, options) => {
      const result = spawnSync(command, args, {
        ...options,
        stdio: "pipe",
        encoding: "utf8",
      });
      logs.push((result.stdout ?? "") + (result.stderr ?? ""));
      return result;
    };
    assert.equal(lintWorkflows({ version, cwd, run }), 0);
    writeFileSync(
      path,
      workflow.replace("echo ok", "echo ${{ nonexistent.value }}"),
    );
    assert.equal(lintWorkflows({ version, cwd, run }), 1);
    assert.match(logs.join("\n"), /nonexistent/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
