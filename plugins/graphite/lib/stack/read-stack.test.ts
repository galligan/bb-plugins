import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createFixture, type Fixture } from "./fixture.ts";
import {
  KNOWN_MIGRATIONS,
  readStack,
  StackReadError,
  type StackBranch,
  type StackSnapshot,
} from "./index.ts";

function branch(snapshot: StackSnapshot, name: string): StackBranch {
  const found = snapshot.branches.find((candidate) => candidate.name === name);
  assert.ok(found, `expected a branch named ${name}`);
  return found;
}

describe("readStack", () => {
  describe("a linear stack", () => {
    let fixture: Fixture;
    let snapshot: StackSnapshot;

    before(async () => {
      fixture = await createFixture();
      const main = await fixture.head("main");
      const featureA = await fixture.commit("feat-a", "a");
      const featureB = await fixture.commit("feat-b", "b");
      fixture.writeMetadata([
        {
          branch_name: "main",
          children: '["feat-a"]',
          branch_revision: main,
          validation_result: "TRUNK",
        },
        {
          branch_name: "feat-a",
          parent_branch_name: "main",
          parent_branch_revision: main,
          children: '["feat-b"]',
          branch_revision: featureA,
          validation_result: "VALID",
        },
        {
          branch_name: "feat-b",
          parent_branch_name: "feat-a",
          parent_branch_revision: featureA,
          children: "[]",
          branch_revision: featureB,
          validation_result: "VALID",
        },
      ]);
      snapshot = await readStack({ repoPath: fixture.path });
    });

    after(() => fixture.dispose());

    it("reports every tracked branch once", () => {
      assert.deepEqual(
        snapshot.branches.map((candidate) => candidate.name),
        ["feat-a", "feat-b", "main"],
      );
    });

    it("builds the parent and child edges", () => {
      assert.equal(branch(snapshot, "main").parent, null);
      assert.deepEqual(branch(snapshot, "main").children, ["feat-a"]);
      assert.equal(branch(snapshot, "feat-a").parent, "main");
      assert.deepEqual(branch(snapshot, "feat-a").children, ["feat-b"]);
      assert.deepEqual(branch(snapshot, "feat-b").children, []);
      assert.deepEqual(snapshot.roots, ["main"]);
      assert.deepEqual(snapshot.cycles, []);
    });

    it("marks trunk from the repository config, not from validation_result", () => {
      assert.equal(snapshot.trunk, "main");
      assert.equal(branch(snapshot, "main").isTrunk, true);
      assert.equal(branch(snapshot, "feat-a").isTrunk, false);
    });

    it("finds nothing to report", () => {
      assert.deepEqual(snapshot.issues, []);
      assert.ok(snapshot.branches.every((candidate) => !candidate.isStale));
      assert.ok(snapshot.branches.every((candidate) => !candidate.needsRestack));
    });
  });

  describe("a branching stack", () => {
    let fixture: Fixture;
    let snapshot: StackSnapshot;

    before(async () => {
      fixture = await createFixture();
      const main = await fixture.head("main");
      const featureAFirst = await fixture.commit("feat-a", "a1");
      const featureASecond = await fixture.commit("feat-a", "a2");
      await fixture.git("checkout", "feat-a");
      const featureB = await fixture.commit("feat-b", "b");
      await fixture.git("checkout", "feat-a");
      const featureC = await fixture.commit("feat-c", "c");
      fixture.writeMetadata([
        {
          branch_name: "main",
          children: '["feat-a"]',
          branch_revision: main,
          validation_result: "TRUNK",
        },
        {
          branch_name: "feat-a",
          parent_branch_name: "main",
          parent_branch_revision: main,
          children: '["feat-b","feat-c"]',
          branch_revision: featureASecond,
          validation_result: "VALID",
        },
        {
          branch_name: "feat-b",
          parent_branch_name: "feat-a",
          parent_branch_revision: featureASecond,
          children: "[]",
          branch_revision: featureB,
          validation_result: "VALID",
        },
        // Stacked on feat-a before its second commit: Graphite prints "(needs restack)".
        {
          branch_name: "feat-c",
          parent_branch_name: "feat-a",
          parent_branch_revision: featureAFirst,
          children: "[]",
          branch_revision: featureC,
          validation_result: "VALID",
        },
      ]);
      snapshot = await readStack({ repoPath: fixture.path });
    });

    after(() => fixture.dispose());

    it("gives one parent two children, sorted", () => {
      assert.deepEqual(branch(snapshot, "feat-a").children, ["feat-b", "feat-c"]);
      assert.deepEqual(snapshot.roots, ["main"]);
      assert.deepEqual(snapshot.issues, []);
    });

    it("flags only the child left behind its parent's head", () => {
      assert.equal(branch(snapshot, "feat-b").needsRestack, false);
      assert.equal(branch(snapshot, "feat-c").needsRestack, true);
    });
  });

  describe("a branch the repository has moved past", () => {
    let fixture: Fixture;
    let snapshot: StackSnapshot;
    let recorded: string;
    let actual: string;

    before(async () => {
      fixture = await createFixture();
      const main = await fixture.head("main");
      recorded = await fixture.commit("feat-a", "a1");
      actual = await fixture.commit("feat-a", "a2");
      fixture.writeMetadata([
        {
          branch_name: "main",
          children: '["feat-a"]',
          branch_revision: main,
          validation_result: "TRUNK",
        },
        {
          branch_name: "feat-a",
          parent_branch_name: "main",
          parent_branch_revision: main,
          children: "[]",
          branch_revision: recorded,
          validation_result: "VALID",
        },
      ]);
      snapshot = await readStack({ repoPath: fixture.path });
    });

    after(() => fixture.dispose());

    it("reports both the recorded revision and the real head", () => {
      const stale = branch(snapshot, "feat-a");
      assert.equal(stale.recordedRevision, recorded);
      assert.equal(stale.actualHead, actual);
      assert.equal(stale.isStale, true);
    });

    it("leaves branches that agree with git unflagged", () => {
      assert.equal(branch(snapshot, "main").isStale, false);
    });
  });

  describe("metadata the reader cannot trust", () => {
    let fixture: Fixture;
    let snapshot: StackSnapshot;

    before(async () => {
      fixture = await createFixture();
      const main = await fixture.head("main");
      const featureA = await fixture.commit("feat-a", "a");
      await fixture.git("checkout", "main");
      const featureD = await fixture.commit("feat-d", "d");
      fixture.writeMetadata([
        // Names a child that has no row of its own.
        {
          branch_name: "main",
          children: '["feat-a","ghost"]',
          branch_revision: main,
          validation_result: "TRUNK",
        },
        // `children` is not JSON. The branch itself is still usable.
        {
          branch_name: "feat-a",
          parent_branch_name: "main",
          parent_branch_revision: main,
          children: "{not json",
          branch_revision: featureA,
          validation_result: "VALID",
        },
        // No branch_name at all.
        { branch_name: "", parent_branch_name: "main", branch_revision: main },
        // A blob where Graphite writes text.
        {
          branch_name: "feat-blob",
          parent_branch_name: new Uint8Array([0xff, 0x00]),
          branch_revision: main,
        },
        // Parent was deleted from the metadata.
        {
          branch_name: "feat-d",
          parent_branch_name: "gone",
          parent_branch_revision: main,
          children: "[]",
          branch_revision: featureD,
          validation_result: "VALID",
        },
      ]);
      snapshot = await readStack({ repoPath: fixture.path });
    });

    after(() => fixture.dispose());

    it("skips the unusable rows and says why", () => {
      assert.deepEqual(
        snapshot.issues.filter((issue) => issue.kind === "row_skipped"),
        [
          { kind: "row_skipped", branch: null, reason: "branch_name is missing or not text" },
          { kind: "row_skipped", branch: "feat-blob", reason: "parent_branch_name is not text" },
        ],
      );
      assert.deepEqual(
        snapshot.branches.map((candidate) => candidate.name),
        ["feat-a", "feat-d", "main"],
      );
    });

    it("keeps a branch whose children column is malformed", () => {
      assert.deepEqual(
        snapshot.issues.filter((issue) => issue.kind === "malformed_field"),
        [
          {
            kind: "malformed_field",
            branch: "feat-a",
            field: "children",
            reason: "not valid JSON",
          },
        ],
      );
      assert.equal(branch(snapshot, "feat-a").parent, "main");
    });

    it("drops a row whose branch git no longer has, and says so", () => {
      // Graphite keeps metadata for deleted branches; counting them inflates
      // every total. `gt ls` does not show them and neither do we.
      assert.ok(!snapshot.branches.some((candidate) => candidate.name === "ghost"));
      assert.ok(
        snapshot.issues.every(
          (issue) => issue.kind !== "missing_branch" || issue.branch !== "feat-a",
        ),
      );
    });

    it("reports a parent that has no row and treats the branch as a root", () => {
      assert.deepEqual(
        snapshot.issues.filter((issue) => issue.kind === "missing_parent"),
        [{ kind: "missing_parent", branch: "feat-d", parent: "gone" }],
      );
      assert.deepEqual(snapshot.roots, ["feat-d", "main"]);
    });

    it("reports a children column that disagrees with the parent pointers", () => {
      assert.deepEqual(
        snapshot.issues.filter((issue) => issue.kind === "children_mismatch"),
        [
          {
            kind: "children_mismatch",
            branch: "main",
            recorded: ["feat-a", "ghost"],
            derived: ["feat-a"],
          },
        ],
      );
    });
  });

  describe("a parent cycle", () => {
    let fixture: Fixture;
    let snapshot: StackSnapshot;

    before(async () => {
      fixture = await createFixture();
      const main = await fixture.head("main");
      const featureX = await fixture.commit("feat-x", "x");
      await fixture.git("checkout", "main");
      const featureY = await fixture.commit("feat-y", "y");
      fixture.writeMetadata([
        { branch_name: "main", children: "[]", branch_revision: main, validation_result: "TRUNK" },
        {
          branch_name: "feat-x",
          parent_branch_name: "feat-y",
          parent_branch_revision: featureY,
          children: '["feat-y"]',
          branch_revision: featureX,
          validation_result: "VALID",
        },
        {
          branch_name: "feat-y",
          parent_branch_name: "feat-x",
          parent_branch_revision: featureX,
          children: '["feat-x"]',
          branch_revision: featureY,
          validation_result: "VALID",
        },
      ]);
      snapshot = await readStack({ repoPath: fixture.path });
    });

    after(() => fixture.dispose());

    it("returns instead of looping, and names the branches in the cycle", () => {
      assert.equal(snapshot.cycles.length, 1);
      assert.deepEqual([...snapshot.cycles[0]].sort(), ["feat-x", "feat-y"]);
      assert.deepEqual(
        snapshot.issues.filter((issue) => issue.kind === "cycle"),
        [{ kind: "cycle", branches: snapshot.cycles[0] }],
      );
    });

    it("keeps the cycle out of the roots", () => {
      assert.deepEqual(snapshot.roots, ["main"]);
    });
  });

  describe("a database whose schema has moved", () => {
    let fixture: Fixture;

    before(async () => {
      fixture = await createFixture();
    });

    after(() => fixture.dispose());

    it("reports a clean schema when the migrations are the known set", async () => {
      fixture.writeMetadata([{ branch_name: "main", children: "[]", validation_result: "TRUNK" }]);
      const snapshot = await readStack({ repoPath: fixture.path });
      assert.deepEqual(snapshot.schema.migrations, KNOWN_MIGRATIONS);
      assert.deepEqual(snapshot.schema.unexpected, []);
      assert.deepEqual(snapshot.schema.missing, []);
      assert.deepEqual(snapshot.issues, []);
    });

    it("names a migration it does not know and still returns the stack", async () => {
      const moved = await createFixture();
      try {
        moved.writeMetadata([{ branch_name: "main", children: "[]", validation_result: "TRUNK" }], {
          migrations: [...KNOWN_MIGRATIONS, "20270101_add_something"],
        });
        const snapshot = await readStack({ repoPath: moved.path });
        assert.deepEqual(snapshot.schema.unexpected, ["20270101_add_something"]);
        assert.deepEqual(snapshot.issues, [
          { kind: "schema_changed", unexpected: ["20270101_add_something"], missing: [] },
        ]);
        assert.deepEqual(
          snapshot.branches.map((candidate) => candidate.name),
          ["main"],
        );
      } finally {
        moved.dispose();
      }
    });

    it("names a migration it expected and did not find", async () => {
      const older = await createFixture();
      try {
        older.writeMetadata([{ branch_name: "main", children: "[]", validation_result: "TRUNK" }], {
          migrations: KNOWN_MIGRATIONS.slice(0, 1),
        });
        const snapshot = await readStack({ repoPath: older.path });
        assert.deepEqual(snapshot.schema.missing, KNOWN_MIGRATIONS.slice(1));
        assert.deepEqual(snapshot.issues, [
          { kind: "schema_changed", unexpected: [], missing: KNOWN_MIGRATIONS.slice(1) },
        ]);
      } finally {
        older.dispose();
      }
    });
  });

  describe("a repository Graphite does not track", () => {
    let fixture: Fixture;

    before(async () => {
      fixture = await createFixture();
    });

    after(() => fixture.dispose());

    it("throws a coded error rather than an empty stack", async () => {
      await assert.rejects(
        () => readStack({ repoPath: fixture.path }),
        (error: unknown) =>
          error instanceof StackReadError && error.code === "no_graphite_metadata",
      );
    });
  });
});
