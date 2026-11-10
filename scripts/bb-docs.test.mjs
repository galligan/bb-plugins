import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSnapshot, rewriteLinks } from "./bb-docs.mjs";

test("links retain mirrored targets and pin external source references without changing code", () => {
  const markdown = [
    "[local](other.md#part)",
    "[source](../src/file.ts#L2)",
    "![image](assets/image.png)",
    "[web](https://example.com) [anchor](#here) [route](/plugin-guide)",
    '[ref]: ../src/file.ts "title"',
    "[space](<../src/a file.ts>)",
    "`[code](../src/file.ts)`",
    "```md\n[example](../src/file.ts)\n```",
  ].join("\n");
  const output = rewriteLinks(
    markdown,
    "docs/start.md",
    new Set(["docs/other.md", "docs/assets/image.png"]),
    "abc123",
  );
  assert.equal(
    output,
    markdown
      .replace(
        "[source](../src/file.ts#L2)",
        "[source](https://github.com/get-bb/bb/blob/abc123/src/file.ts#L2)",
      )
      .replace(
        '[ref]: ../src/file.ts "title"',
        '[ref]: https://github.com/get-bb/bb/blob/abc123/src/file.ts "title"',
      )
      .replace(
        "<../src/a file.ts>",
        "<https://github.com/get-bb/bb/blob/abc123/src/a file.ts>",
      ),
  );
});

test("snapshot includes upstream docs, skills, license, and provenance", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bb-docs-test-"));
  try {
    const source = path.join(root, "source");
    mkdirSync(path.join(source, "docs/assets"), { recursive: true });
    mkdirSync(path.join(source, "plugins/bb-guide/skills/example"), {
      recursive: true,
    });
    writeFileSync(path.join(source, "LICENSE"), "upstream license");
    writeFileSync(
      path.join(source, "docs/start.md"),
      "[source](../src/file.ts)",
    );
    writeFileSync(
      path.join(source, "docs/assets/test.png"),
      Buffer.from([0, 1, 255]),
    );
    writeFileSync(
      path.join(source, "plugins/bb-guide/skills/example/SKILL.md"),
      "skill",
    );
    const target = path.join(root, "snapshot");
    assert.equal(buildSnapshot(source, target, "abc123", "main"), 4);
    assert.equal(
      readFileSync(path.join(target, "docs/start.md"), "utf8"),
      "[source](https://github.com/get-bb/bb/blob/abc123/src/file.ts)",
    );
    assert.deepEqual(
      readFileSync(path.join(target, "docs/assets/test.png")),
      Buffer.from([0, 1, 255]),
    );
    const provenance = JSON.parse(
      readFileSync(path.join(target, "sync.json"), "utf8"),
    );
    assert.equal(provenance.commit, "abc123");
    assert.equal(provenance.branch, "main");
    assert.ok(Number.isFinite(Date.parse(provenance.fetchedAt)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refresh replaces stale files and failed fetch preserves the previous snapshot", async () => {
  const { execFileSync } = await import("node:child_process");
  const { cpSync, existsSync, renameSync } = await import("node:fs");
  const root = mkdtempSync(path.join(tmpdir(), "bb-docs-refresh-"));
  try {
    const source = path.join(root, "remote");
    const target = path.join(root, "workspace");
    mkdirSync(path.join(source, "docs"), { recursive: true });
    mkdirSync(path.join(source, "plugins/bb-guide/skills/example"), {
      recursive: true,
    });
    mkdirSync(path.join(target, "scripts"), { recursive: true });
    writeFileSync(path.join(source, "LICENSE"), "license");
    writeFileSync(path.join(source, "docs/old.md"), "old");
    writeFileSync(
      path.join(source, "plugins/bb-guide/skills/example/SKILL.md"),
      "skill",
    );
    const git = (...args) =>
      execFileSync("git", args, { cwd: source, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    const commit = () => {
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "fixture",
      );
    };
    commit();
    cpSync(
      path.join(import.meta.dirname, "bb-docs.mjs"),
      path.join(target, "scripts/bb-docs.mjs"),
    );
    const count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: String(count + 1),
      [`GIT_CONFIG_KEY_${count}`]: `url.file://${source}.insteadOf`,
      [`GIT_CONFIG_VALUE_${count}`]: "https://github.com/get-bb/bb.git",
    };
    const refresh = () =>
      execFileSync(
        process.execPath,
        [path.join(target, "scripts/bb-docs.mjs")],
        { env, stdio: "pipe" },
      );
    refresh();
    const snapshot = path.join(target, "docs/bb/upstream");
    assert.ok(existsSync(path.join(snapshot, "docs/old.md")));
    rmSync(path.join(source, "docs/old.md"));
    writeFileSync(path.join(source, "docs/new.md"), "new");
    commit();
    refresh();
    assert.equal(existsSync(path.join(snapshot, "docs/old.md")), false);
    assert.equal(
      readFileSync(path.join(snapshot, "docs/new.md"), "utf8"),
      "new",
    );
    const provenance = readFileSync(path.join(snapshot, "sync.json"), "utf8");
    renameSync(source, `${source}-unavailable`);
    assert.throws(refresh);
    assert.equal(
      readFileSync(path.join(snapshot, "sync.json"), "utf8"),
      provenance,
    );
    assert.equal(
      readFileSync(path.join(snapshot, "docs/new.md"), "utf8"),
      "new",
    );
    assert.equal(existsSync(path.join(target, "docs/bb/.sync")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
