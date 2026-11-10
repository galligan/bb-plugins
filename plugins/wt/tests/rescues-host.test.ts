import assert from "node:assert/strict";
import { test } from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import host from "../host.ts";
import { fixture } from "../lib/fixture.ts";

test("project rescue listing skips a non-repository folder without an error", async (t) => {
  const f = await fixture(t);
  const harness = experimental_createHostEntryHarness(host);
  t.after(() => harness.experimental_dispose());
  const result = await harness.experimental_call("rescues", {
    sourcePaths: [f.base, f.source],
  });
  assert.deepEqual(result.sources, [
    { sourcePath: f.base, refs: [], error: null },
    { sourcePath: f.source, refs: [], error: null },
  ]);
});

test("project rescue listing keeps repository failures visible", async (t) => {
  const f = await fixture(t);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${f.source}/.git/packed-refs`, "invalid packed refs\n");
  const harness = experimental_createHostEntryHarness(host);
  t.after(() => harness.experimental_dispose());
  const result = await harness.experimental_call("rescues", {
    sourcePaths: [f.source],
  });
  assert.equal(result.sources[0]?.refs.length, 0);
  assert.match(result.sources[0]?.error ?? "", /Could not list rescue refs/u);
});
