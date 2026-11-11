import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("the retired launcher refuses every old verb without invoking an inherited BB target", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "graphite-retired-launcher-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const marker = join(directory, "invoked");
  const executable = join(directory, "bb");
  writeFileSync(executable, '#!/bin/sh\n: > "$PROBE_FILE"\nexit 99\n', {
    mode: 0o755,
  });
  const script = fileURLToPath(
    new URL("../scripts/bb-test-instance.sh", import.meta.url),
  );
  for (const args of [
    [],
    ["start"],
    ["stop"],
    ["status"],
    ["install"],
    ["env"],
    ["run", "plugin", "install", "."],
  ]) {
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        BB_CLI: executable,
        BB_APP_BIN: executable,
        BB_DATA_DIR: join(directory, "live-data"),
        BB_SERVER_URL: "http://127.0.0.1:38886",
        BB_THREAD_ID: "thr_parent",
        BB_PROJECT_ID: "proj_parent",
        BB_ENVIRONMENT_ID: "env_parent",
        PROBE_FILE: marker,
      },
      timeout: 5_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /retired; no command was run/);
    assert.match(result.stderr, /bun run bb-target/);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(directory, "live-data")), false);
  }
});
