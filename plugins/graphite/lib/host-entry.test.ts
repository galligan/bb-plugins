import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, it, mock } from "node:test";
import { setTimeout } from "node:timers/promises";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";

import { createFixture } from "./stack/fixture.ts";

// Resolve a disposable CLI before importing the real entry. Never invoke an
// installed gt or change the user's HOME/PATH. Node isolates this test file.
const directory = await mkdtemp(join(os.tmpdir(), "graphite-host-entry-"));
const bin = join(directory, ".local/share/npm/bin");
await mkdir(bin, { recursive: true });
await writeFile(
  join(bin, "gt"),
  `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "wait") {
  fs.writeFileSync(args[1], String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify(args));
}
`,
  { mode: 0o755 },
);
const home = mock.method(os, "homedir", () => directory);
syncBuiltinESMExports();
const { default: entry } = await import("../host.ts");
home.mock.restore();
syncBuiltinESMExports();
after(() => rm(directory, { recursive: true, force: true }));

it("imports the actual host entry and validates stack requests and results", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.dispose());
  const harness = experimental_createHostEntryHarness(entry);
  t.after(() => harness.experimental_dispose());
  const head = await fixture.head("main");
  fixture.writeMetadata([{ branch_name: "main", branch_revision: head }]);

  const result = await harness.experimental_call("stack", {
    repoPath: fixture.path,
    branchName: "main",
  });
  assert.equal(result.outcome, "stacked");
  if (result.outcome === "stacked") {
    assert.equal(result.branch, "main");
    assert.equal(result.total, 1);
    assert.equal(result.branches[0]?.isCurrent, true);
    assert.deepEqual(result.warnings, []);
  }
  await assert.rejects(
    // @ts-expect-error Deliberately invalid wire input.
    harness.experimental_call("stack", { repoPath: 42, branchName: "main" }),
    /string/,
  );
});

it("runs the host gt handler with noninteractive arguments through the contract", async (t) => {
  const harness = experimental_createHostEntryHarness(entry);
  t.after(() => harness.experimental_dispose());
  assert.deepEqual(
    await harness.experimental_call("gt", { cwd: directory, args: ["probe"] }),
    {
      outcome: "ran",
      exitCode: 0,
      stdout: JSON.stringify(["probe", "--no-interactive"]),
      stderr: "",
    },
  );
});

for (const action of ["cancel", "dispose"] as const) {
  it(
    `${action} stops an active host CLI process`,
    { timeout: 10_000 },
    async (t) => {
      const harness = experimental_createHostEntryHarness(entry);
      const controller = new AbortController();
      t.after(() => harness.experimental_dispose());
      const marker = join(directory, `${action}.pid`);
      const call = harness.experimental_call(
        "gt",
        { cwd: directory, args: ["wait", marker] },
        { signal: controller.signal },
      );
      let pid: number | undefined;
      t.after(() => {
        if (pid !== undefined) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* Already stopped. */
          }
        }
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await readFile(marker, "utf8").catch(() => "");
        if (value) {
          pid = Number(value);
          break;
        }
        await setTimeout(20);
      }
      assert.ok(pid, "fixture process must start before cancellation");
      if (action === "cancel") controller.abort();
      else await harness.experimental_dispose();
      const result = await call;
      assert.equal(result.outcome, "ran");
      if (result.outcome === "ran") assert.equal(result.exitCode, 1);
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          process.kill(pid, 0);
        } catch {
          pid = undefined;
          break;
        }
        await setTimeout(20);
      }
      assert.equal(pid, undefined, "cancelled child must exit");
      await harness.experimental_dispose();
      await harness.experimental_dispose();
      assert.equal(harness.experimental_lifecycleSignal.aborted, true);
      await assert.rejects(
        harness.experimental_call("gt", { cwd: directory, args: ["probe"] }),
        /disposed/,
      );
      const replacement = experimental_createHostEntryHarness(entry);
      t.after(() => replacement.experimental_dispose());
      assert.equal(
        (
          await replacement.experimental_call("gt", {
            cwd: directory,
            args: ["probe"],
          })
        ).outcome,
        "ran",
      );
    },
  );
}
