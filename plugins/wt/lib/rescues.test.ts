import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, git } from "./fixture.ts";
import { restoreCommand } from "./rescue-schema.ts";
import { listRescues } from "./rescues.ts";

test("rescues lists only rescue refs with metadata and rejects a non-repository", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await listRescues(f.source), []);
  git(f.source, "update-ref", "refs/wt-rescue/one", "HEAD");
  git(f.source, "update-ref", "refs/wt-rescue/two", "HEAD");
  const refs = await listRescues(f.source);
  assert.deepEqual(
    refs.map((ref) => ref.ref),
    ["refs/wt-rescue/one", "refs/wt-rescue/two"],
  );
  assert.equal(refs[0]?.commit, git(f.source, "rev-parse", "HEAD"));
  assert.equal(refs[0]?.subject, "init");
  assert.ok((refs[0]?.createdAt ?? 0) > 0);
  await assert.rejects(listRescues(f.base), /repository/u);
});

test("restore commands quote shell metacharacters in ref names", () => {
  assert.equal(
    restoreCommand("refs/wt-rescue/a;$HOME"),
    "git checkout 'refs/wt-rescue/a;$HOME' -- .",
  );
});
