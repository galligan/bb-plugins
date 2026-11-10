import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { SourceService } from "./service.ts";
import { provenanceSchema } from "../results.ts";

const row = {
  path: "synthetic.ts",
  previousPath: null,
  changeKind: "modified",
  additions: 1,
  deletions: 0,
  binary: false,
  origin: "tracked",
  loadMode: "auto",
  revision: "synthetic-revision",
};
const status = {
  insertions: 1,
  deletions: 0,
  lineStatsComplete: true,
  fileCount: 1,
  files: [{ path: "synthetic.ts", status: "M", insertions: 1, deletions: 0 }],
};
const workspace = {
  checkout: {
    kind: "branch",
    branchName: "synthetic-feature",
    headSha: "a".repeat(40),
  },
  workingTree: {
    ...status,
    hasUncommittedChanges: true,
    state: "dirty_uncommitted",
  },
  mergeBase: {
    ...status,
    mergeBaseBranch: "main",
    baseRef: "b".repeat(40),
    aheadCount: 1,
    behindCount: 0,
    squashMergeCheckComplete: true,
    hasCommittedUnmergedChanges: true,
  },
};
const files = {
  outcome: "available",
  files: [row],
  truncated: false,
  shortstat: "synthetic summary",
  mergeBaseRef: null,
  initialPatches: [
    { path: "synthetic.ts", patch: "must not be projected", truncated: false },
  ],
};
const diff = {
  outcome: "available",
  diff: {
    diff: "+synthetic",
    truncated: false,
    shortstat: "synthetic summary",
    files: "synthetic.ts",
    mergeBaseRef: null,
  },
};
function setup(response: unknown = files) {
  const host = createFakePluginHost({
    pluginId: "judge",
    sdk: { plugins: { callRpc: async () => response } },
  });
  const sources = new SourceService(host.bb.sdk);
  return {
    ...host,
    sources,
    close: async () => {
      sources.dispose();
      await host.harness.lifecycle.dispose();
    },
  };
}

test("Git reads require an explicit environment and never select one from a thread", async () => {
  const h = setup();
  try {
    assert.deepEqual(
      await h.sources.read(
        { from: "git.changedFiles", target: "uncommitted" },
        { threadId: "thread" },
      ),
      {
        status: "unavailable",
        reason: "source_unavailable",
        code: "environment_required",
      },
    );
    assert.equal(h.harness.inspection.sdk.callsTo("plugins.callRpc").length, 0);
    await assert.rejects(
      h.sources.read(
        { from: "git.diff", target: "uncommitted" },
        { environmentId: "" },
      ),
    );
    await assert.rejects(
      h.sources.read(
        { from: "git.diff", target: "branch" },
        { environmentId: "env" },
      ),
    );
  } finally {
    await h.close();
  }
});

test("both explicit Git targets route only to public read methods and retain private observations", async () => {
  for (const target of ["uncommitted", "branch"]) {
    for (const [from, response, method] of [
      ["git.changedFiles", files, "files"],
      ["git.diff", diff, "diff"],
      ["git.status", { outcome: "available", workspace }, "workspaceStatus"],
    ] as const) {
      const h = setup(response);
      try {
        const result = await h.sources.read(
          { from, target, ...(target === "branch" ? { base: "main" } : {}) },
          { environmentId: "exact-env", threadId: "different-thread" },
        );
        assert.equal(result.status, "ok");
        if (result.status !== "ok") continue;
        assert.equal(result.sensitive, true);
        provenanceSchema.parse(result.provenance);
        assert.equal(result.provenance.selection.environmentId, "exact-env");
        assert.equal(result.provenance.selection.target, target);
        assert.equal(
          result.provenance.selection.base,
          target === "branch" ? "main" : undefined,
        );
        const call = h.harness.inspection.sdk.callsTo(
          "plugins.callRpc",
        )[0]![0] as {
          pluginId: string;
          method: string;
          input: unknown;
          signal: AbortSignal;
        };
        assert.equal(call.pluginId, "bb--git");
        assert.equal(call.method, method);
        const input =
          method === "workspaceStatus"
            ? {
                environmentId: "exact-env",
                ...(target === "branch" ? { mergeBaseBranch: "main" } : {}),
              }
            : {
                environmentId: "exact-env",
                target:
                  target === "branch"
                    ? { type: "branch_committed", mergeBaseBranch: "main" }
                    : { type: "uncommitted" },
                ...(method === "files"
                  ? { ignoreWhitespace: false }
                  : { maxDiffBytes: 65536, maxFileListBytes: 65536 }),
              };
        assert.deepEqual(call.input, input);
        assert.ok(call.signal instanceof AbortSignal);
        assert.equal(h.harness.inspection.sdk.calls.length, 1);
        assert.ok(!JSON.stringify(result).includes("must not be projected"));
      } finally {
        await h.close();
      }
    }
  }
});

test("changed-file revisions survive; observation digest changes with paths or revision, not unused patches", async () => {
  const h = setup();
  try {
    const read = () =>
      h.sources.read(
        { from: "git.changedFiles", target: "uncommitted" },
        { environmentId: "env" },
      );
    const first = await read();
    assert.equal(first.status, "ok");
    h.harness.sdk.stub("plugins.callRpc", async () => ({
      ...files,
      initialPatches: [],
    }));
    const same = await read();
    h.harness.sdk.stub("plugins.callRpc", async () => ({
      ...files,
      files: [{ ...row, revision: "changed" }],
    }));
    const changed = await read();
    assert.ok(
      first.status === "ok" && same.status === "ok" && changed.status === "ok",
    );
    assert.equal(first.provenance.revision, same.provenance.revision);
    assert.notEqual(first.provenance.revision, changed.provenance.revision);
    assert.equal(
      (first.value as { files: (typeof row)[] }).files[0]?.revision,
      row.revision,
    );
  } finally {
    await h.close();
  }
});

test("upstream Git truncation and incomplete line statistics are explicit evidence", async () => {
  for (const [from, response] of [
    ["git.changedFiles", { ...files, truncated: true }],
    ["git.diff", { ...diff, diff: { ...diff.diff, truncated: true } }],
    [
      "git.status",
      {
        outcome: "available",
        workspace: {
          ...workspace,
          workingTree: { ...workspace.workingTree, lineStatsComplete: false },
        },
      },
    ],
  ] as const) {
    const h = setup(response);
    try {
      const result = await h.sources.read(
        { from, target: "uncommitted" },
        { environmentId: "env" },
      );
      assert.equal(result.status, "ok");
      if (result.status === "ok") {
        if (from === "git.status")
          assert.ok(
            JSON.stringify(result.value).includes('"lineStatsComplete":false'),
          );
        else assert.equal(result.provenance.selection.truncated, true);
      }
    } finally {
      await h.close();
    }
  }
});

test("Git response shape errors, missing base, partial status and wrong base fail closed", async () => {
  const cases = [
    [
      "git.changedFiles",
      { ...files, files: [{ ...row, revision: undefined }] },
    ],
    ["git.changedFiles", { ...files, files: [{ ...row, additions: -1 }] }],
    ["git.changedFiles", { ...files, truncated: undefined }],
    ["git.diff", { ...diff, diff: { ...diff.diff, truncated: undefined } }],
    [
      "git.status",
      { outcome: "available", workspace: { ...workspace, mergeBase: null } },
    ],
    [
      "git.status",
      {
        outcome: "available",
        workspace: {
          ...workspace,
          mergeBase: { ...workspace.mergeBase, mergeBaseBranch: "other" },
        },
      },
    ],
    [
      "git.status",
      {
        outcome: "available",
        workspace: {
          ...workspace,
          mergeBase: { ...workspace.mergeBase, fileCount: 2 },
        },
      },
    ],
    [
      "git.status",
      {
        outcome: "available",
        workspace: {
          ...workspace,
          checkout: { kind: "unknown", reason: "private diagnostic" },
        },
      },
    ],
  ] as const;
  for (const [from, response] of cases) {
    const h = setup(response);
    try {
      const result = await h.sources.read(
        { from, target: "branch", base: "main" },
        { environmentId: "env" },
      );
      assert.equal(result.status, "unavailable");
      assert.ok(!JSON.stringify(result).includes("private diagnostic"));
    } finally {
      await h.close();
    }
  }
});

test("disabled Git, offline/sleeping host, unknown environment and non-Git never leak upstream details or wake/fallback", async () => {
  const h = setup();
  try {
    for (const message of [
      "plugin disabled private detail",
      "machine sleeping private detail",
      "host unavailable private detail",
    ]) {
      h.harness.sdk.stub("plugins.callRpc", async () => {
        throw new Error(message);
      });
      const result = await h.sources.read(
        { from: "git.diff", target: "uncommitted" },
        { environmentId: "env" },
      );
      assert.deepEqual(result, {
        status: "unavailable",
        reason: "source_unavailable",
        code: "source_read_failed",
      });
    }
    for (const response of [
      {
        outcome: "unavailable",
        failure: {
          code: "unknown_environment",
          workspacePath: "/private",
          message: "private",
        },
      },
      {
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "private",
      },
    ]) {
      h.harness.sdk.stub("plugins.callRpc", async () => response);
      const result = await h.sources.read(
        { from: "git.status", target: "uncommitted" },
        { environmentId: "env" },
      );
      assert.equal(result.status, "unavailable");
      assert.ok(!JSON.stringify(result).includes("private"));
    }
    assert.equal(
      h.harness.inspection.sdk.callsTo("plugins.callRpc").length,
      h.harness.inspection.sdk.calls.length,
    );
  } finally {
    await h.close();
  }
});

test("Git projections refuse excessive file counts, bytes and characters without clipping", async () => {
  for (const [from, response, maxChars] of [
    ["git.changedFiles", { ...files, files: Array(1001).fill(row) }, 65536],
    [
      "git.status",
      {
        outcome: "available",
        workspace: {
          ...workspace,
          workingTree: {
            ...workspace.workingTree,
            files: Array(1001).fill(status.files[0]),
          },
        },
      },
      65536,
    ],
    [
      "git.diff",
      { ...diff, diff: { ...diff.diff, diff: "😀".repeat(20000) } },
      65536,
    ],
    ["git.diff", diff, 1],
    [
      "git.changedFiles",
      { ...files, files: [{ ...row, path: "x".repeat(66000) }] },
      65536,
    ],
  ] as const) {
    const h = setup(response);
    try {
      const result = await h.sources.read(
        { from, target: "uncommitted", maxChars },
        { environmentId: "env" },
      );
      assert.equal(
        result.status === "unavailable" && result.reason,
        "too_large",
      );
    } finally {
      await h.close();
    }
  }
});

test("Git RPC participates in deadline/caller/disposal and never dispatches after pre-abort", async () => {
  const h = setup();
  const controller = new AbortController();
  try {
    controller.abort();
    const def = { from: "git.diff", target: "uncommitted" };
    const pre = await h.sources.read(def, {
      environmentId: "env",
      signal: controller.signal,
    });
    assert.equal(pre.status === "unavailable" && pre.reason, "cancelled");
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    let observed: AbortSignal | undefined;
    h.harness.sdk.stub("plugins.callRpc", async (...args: unknown[]) => {
      observed = (args[0] as { signal: AbortSignal }).signal;
      return new Promise(() => {});
    });
    const budget = await h.sources.read(def, {
      environmentId: "env",
      deadlineAt: performance.now() + 15,
    });
    assert.equal(budget.status === "unavailable" && budget.reason, "budget");
    assert.equal(observed?.aborted, true);
    const pending = h.sources.read(def, { environmentId: "env" });
    await new Promise((resolve) => setImmediate(resolve));
    h.sources.dispose();
    const disposed = await pending;
    assert.equal(
      disposed.status === "unavailable" && disposed.reason,
      "cancelled",
    );
    assert.equal(observed?.aborted, true);
  } finally {
    await h.close();
  }
});
