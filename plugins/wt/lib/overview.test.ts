import assert from "node:assert/strict";
import { test } from "node:test";
import {
  joinOverview,
  rowState,
  sortRows,
  removalConsequences,
  environmentSchema,
} from "./overview.ts";
import { inspectionSchema } from "./host-contract.ts";

export const clean = inspectionSchema.parse({
  path: "/wt/a",
  branch: "bb/a",
  changedFiles: 0,
  untrackedFiles: 0,
  editedSharedFiles: [],
  conflictedFiles: 0,
  operation: null,
  unreferencedHead: false,
  unsavedSubmodules: [],
  branchState: "local",
  unpushedCommits: 1,
  lastActivity: 100,
  safeToRemove: true,
  reasons: [],
});
const environment = environmentSchema.parse({
  id: "e",
  projectId: "p",
  hostId: "h",
  environmentProviderInstanceKey: "k",
  status: "ready",
  path: "/wt/a",
  lifecycle: { retireAt: null, teardown: null },
});
const machine = {
  hostId: "h",
  name: "Mac",
  worktrees: [{ status: "present", pathKey: "k", inspection: clean }],
  error: null,
} satisfies Parameters<typeof joinOverview>[0][number];

test("join uses host and path key, includes archived threads, and synthesizes absent records", () => {
  const [joined] = joinOverview(
    [machine],
    [environment],
    [{ id: "t", title: "Task", archived: true, environmentId: "e" }],
  );
  assert.equal(joined?.worktrees[0]?.environment?.id, "e");
  assert.equal(joined?.worktrees[0]?.threads[0]?.archived, true);
  assert.equal(
    joinOverview([machine], [{ ...environment, hostId: "other" }], [])[0]
      ?.worktrees[0]?.environment,
    null,
  );
  const [missing] = joinOverview(
    [{ ...machine, worktrees: [] }],
    [environment],
    [],
  );
  assert.equal(missing?.worktrees[0]?.status, "unreadable");
  assert.match(rowState(missing!.worktrees[0]!, 0).badge ?? "", /record/u);
});

test("all four states and precedence, missing and unreadable records", () => {
  const row = joinOverview([machine], [environment], [])[0]!.worktrees[0]!;
  assert.equal(rowState(row, 0).kind, "in-use");
  assert.equal(rowState({ ...row, environment: null }, 0).kind, "orphaned");
  assert.equal(
    rowState(
      { ...row, environment: { ...row.environment!, retireAt: 720000 } },
      0,
    ).badge,
    "Removes in 12m",
  );
  assert.equal(
    rowState(
      {
        ...row,
        environment: {
          ...row.environment!,
          teardown: { status: "failed", message: "Refused" },
        },
      },
      0,
    ).badge,
    "Refused",
  );
  for (const entry of [
    { ...row, status: "missing", path: "/wt/a" },
    { ...row, status: "unreadable", path: "/wt/a", message: "damaged" },
  ] satisfies Parameters<typeof rowState>[0][]) {
    assert.equal(rowState(entry, 0).kind, "attention");
  }
});

test("sort by state then newest activity and retain a failed machine", () => {
  const row = joinOverview([machine], [environment], [])[0]!.worktrees[0]!;
  const orphan = { ...row, environment: null };
  const retiring = {
    ...row,
    environment: { ...row.environment!, retireAt: 1000 },
  };
  const attention = {
    ...row,
    environment: {
      ...row.environment!,
      teardown: { status: "failed", message: null },
    },
  };
  const newer = { ...row, inspection: { ...clean, lastActivity: 200 } };
  assert.deepEqual(sortRows([orphan, row, retiring, attention, newer], 0), [
    attention,
    retiring,
    newer,
    row,
    orphan,
  ]);
  assert.deepEqual(
    joinOverview(
      [{ ...machine, worktrees: [], error: "offline" }],
      [environment],
      [],
    )[0]?.error,
    "offline",
  );
});

test("confirm split covers every unsafe inspection field", () => {
  for (const patch of [
    { changedFiles: 1 },
    { untrackedFiles: 1 },
    { unreferencedHead: true },
  ]) {
    assert.equal(removalConsequences({ ...clean, ...patch }).saved.length, 1);
    assert.deepEqual(removalConsequences({ ...clean, ...patch }).blocked, []);
  }
  for (const patch of [
    { editedSharedFiles: [".env"] },
    { conflictedFiles: 1 },
    { operation: "rebase" },
    { unsavedSubmodules: ["vendor"] },
  ]) {
    assert.equal(removalConsequences({ ...clean, ...patch }).blocked.length, 1);
  }
  assert.deepEqual(removalConsequences(clean), { saved: [], blocked: [] });
});
