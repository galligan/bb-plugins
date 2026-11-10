import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { setTimeout } from "node:timers/promises";

import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";

import { graphiteHostContract } from "./host-contract.ts";
import { createFixture, type Fixture } from "./stack/fixture.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "timed out waiting for fixture process");
    await setTimeout(10);
  }
}

describe("the real Graphite host entry", { timeout: 15_000 }, () => {
  let root: string;
  let fixture: Fixture;
  let entry: typeof import("../host.ts").default;

  before(async () => {
    root = mkdtempSync(join(os.tmpdir(), "bb-graphite-host-"));
    const binDir = join(root, ".local/share/npm/bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "gt"),
      `#!${process.execPath}
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = args[0];
if (mode.startsWith("wait-")) {
  process.once("SIGTERM", () => {
    writeFileSync(mode + ".stopped", "stopped");
    process.exit(0);
  });
  setInterval(() => {}, 1000);
} else {
  console.log("fixture stdout");
  console.error("fixture stderr");
  process.exitCode = mode === "fail" ? 7 : 0;
}
writeFileSync(mode + ".json", JSON.stringify({ args, cwd: process.cwd() }));
`,
      { mode: 0o755 },
    );

    // Keep gt discovery inside the fixture even when the real CLI is installed.
    const home = mock.method(os, "homedir", () => root);
    try {
      syncBuiltinESMExports();
      entry = (await import("../host.ts")).default;
    } finally {
      home.mock.restore();
      syncBuiltinESMExports();
    }
    fixture = await createFixture();
  });

  after(() => {
    fixture?.dispose();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("imports the product entry and reads real metadata through its contract", async (t) => {
    assert.equal(entry.experimental_apiVersion, 1);
    assert.equal(entry.contract, graphiteHostContract);
    const harness = experimental_createHostEntryHarness(entry);
    t.after(() => harness.experimental_dispose());
    const main = await fixture.head("main");
    const feature = await fixture.commit("feature", "feature");
    fixture.writeMetadata([
      {
        branch_name: "main",
        branch_revision: main,
        children: '["feature"]',
        validation_result: "TRUNK",
      },
      {
        branch_name: "feature",
        parent_branch_name: "main",
        parent_branch_revision: main,
        branch_revision: feature,
        children: "[]",
        validation_result: "VALID",
      },
    ]);

    const result = await harness.experimental_call("stack", {
      repoPath: fixture.path,
      branchName: "feature",
    });
    assert.equal(result.outcome, "stacked");
    if (result.outcome !== "stacked") assert.fail("expected a stack");
    assert.equal(result.branch, "feature");
    assert.equal(result.needsRestack, false);
    assert.equal(result.isStale, false);
    assert.deepEqual(result.warnings, []);
    assert.ok(result.branches.some((branch) => branch.isCurrent));
    assert.equal(harness.experimental_getRetainedWorkerLeaseCount(), 0);
    assert.deepEqual(harness.experimental_getSignals(), []);
  });

  it("validates host inputs and returns a typed missing-repository result", async (t) => {
    const harness = experimental_createHostEntryHarness(entry);
    t.after(() => harness.experimental_dispose());
    await assert.rejects(
      // @ts-expect-error Exercise untyped wire input at the public boundary.
      harness.experimental_call("stack", { repoPath: 42, branchName: "main" }),
      /expected string/i,
    );
    await assert.rejects(
      // @ts-expect-error Exercise untyped wire input before it can launch gt.
      harness.experimental_call("gt", { cwd: root, args: "report" }),
      /expected array/i,
    );
    assert.deepEqual(
      await harness.experimental_call("stack", {
        repoPath: join(root, "missing"),
        branchName: "main",
      }),
      { outcome: "none", reason: "not a repository" },
    );
  });

  it("passes cwd and non-interactive arguments to gt and preserves exit output", async (t) => {
    const harness = experimental_createHostEntryHarness(entry);
    t.after(() => harness.experimental_dispose());
    for (const [mode, exitCode] of [
      ["report", 0],
      ["fail", 7],
    ] as const) {
      assert.deepEqual(
        await harness.experimental_call("gt", { cwd: root, args: [mode] }),
        {
          outcome: "ran",
          exitCode,
          stdout: "fixture stdout\n",
          stderr: "fixture stderr\n",
        },
      );
      assert.deepEqual(
        JSON.parse(readFileSync(join(root, `${mode}.json`), "utf8")),
        { args: [mode, "--no-interactive"], cwd: root },
      );
    }
  });

  for (const cancellation of ["request", "dispose"] as const) {
    it(`terminates an active gt process on ${cancellation} cancellation`, async (t) => {
      const harness = experimental_createHostEntryHarness(entry);
      const controller = new AbortController();
      t.after(async () => {
        controller.abort();
        await harness.experimental_dispose();
      });
      const mode = `wait-${cancellation}`;
      const call = harness.experimental_call(
        "gt",
        { cwd: root, args: [mode] },
        { signal: controller.signal },
      );
      await waitFor(() => {
        try {
          return readFileSync(join(root, `${mode}.json`), "utf8").length > 0;
        } catch {
          return false;
        }
      });
      if (cancellation === "request") controller.abort();
      else await harness.experimental_dispose();
      const result = await call;
      assert.ok(result.outcome !== "ran" || result.exitCode !== 0);
      await waitFor(() => {
        try {
          return (
            readFileSync(join(root, `${mode}.stopped`), "utf8") === "stopped"
          );
        } catch {
          return false;
        }
      });

      await harness.experimental_dispose();
      await harness.experimental_dispose();
      assert.equal(harness.experimental_lifecycleSignal.aborted, true);
      assert.equal(harness.experimental_getRetainedWorkerLeaseCount(), 0);
      await assert.rejects(
        harness.experimental_call("gt", { cwd: root, args: [mode] }),
        /disposed/,
      );
      const replacement = experimental_createHostEntryHarness(entry);
      t.after(() => replacement.experimental_dispose());
      const fresh = await replacement.experimental_call("gt", {
        cwd: root,
        args: ["report"],
      });
      assert.equal(fresh.outcome, "ran");
      if (fresh.outcome !== "ran") assert.fail("expected fresh entry to run");
      assert.equal(fresh.exitCode, 0);
    });
  }
});
