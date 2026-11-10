import assert from "node:assert/strict";
import { test } from "node:test";
import { autolabel, labelsForFiles } from "./autolabel.mjs";

function fixture({ files = [], existing = [], createError, pr = true } = {}) {
  const calls = { created: [], added: [], content: [], pages: [] };
  const context = {
    repo: { owner: "example", repo: "plugins" },
    sha: "trusted-main",
    payload: pr
      ? { pull_request: { number: 42, base: { sha: "trusted-base" } } }
      : {},
  };
  const github = {
    rest: {
      repos: {
        getContent: async (args) => {
          calls.content.push(args);
          return {
            data: [
              { type: "dir", name: "wt" },
              { type: "file", name: "README.md" },
            ],
          };
        },
      },
      pulls: { listFiles: "files" },
      issues: {
        listLabelsForRepo: "labels",
        createLabel: async (args) => {
          calls.created.push(args);
          if (createError) throw createError;
        },
        addLabels: async (args) => calls.added.push(args),
      },
    },
    paginate: async (endpoint, args) => {
      calls.pages.push({ endpoint, ...args });
      return endpoint === "files" ? files : existing.map((name) => ({ name }));
    },
  };
  return { github, context, calls };
}

test("paths cover multiple plugins, removals, and both sides of renames", () => {
  assert.deepEqual(
    labelsForFiles([
      { filename: "plugins/wt/server.ts", status: "removed" },
      {
        filename: "plugins/new/app.ts",
        previous_filename: "plugins/old/app.ts",
      },
      { filename: "docs/app.ts", previous_filename: "plugins/moved/app.ts" },
      { filename: "plugins/wt/README.md" },
      { filename: "plugins/README.md" },
      { filename: "repos/plugin/example.ts" },
    ]),
    ["plugin/moved", "plugin/new", "plugin/old", "plugin/wt"],
  );
});

test("creates new plugin labels and adds all matching labels without replacing existing ones", async () => {
  const f = fixture({
    files: [
      { filename: "plugins/new/server.ts" },
      { filename: "plugins/wt/app.ts" },
    ],
    existing: ["plugin/WT", "bug"],
  });
  await autolabel(f);
  assert.deepEqual(
    f.calls.created.map((label) => label.name),
    ["plugin/new"],
  );
  assert.deepEqual(f.calls.added, [
    {
      owner: "example",
      repo: "plugins",
      issue_number: 42,
      labels: ["plugin/new", "plugin/wt"],
    },
  ]);
  assert.equal(f.calls.content[0].ref, "trusted-base");
  assert.equal(f.calls.pages[0].per_page, 100);
});

test("push or manual run creates directory labels without touching PRs", async () => {
  const f = fixture({ pr: false });
  await autolabel(f);
  assert.deepEqual(
    f.calls.created.map((label) => label.name),
    ["plugin/wt"],
  );
  assert.deepEqual(f.calls.added, []);
  assert.equal(f.calls.content[0].ref, "trusted-main");
  assert.deepEqual(
    f.calls.pages.map((page) => page.endpoint),
    ["labels"],
  );
});

test("root-only PRs do not receive a plugin label", async () => {
  const f = fixture({
    files: [{ filename: "README.md" }],
    existing: ["plugin/wt"],
  });
  await autolabel(f);
  assert.deepEqual(f.calls.added, []);
  assert.deepEqual(f.calls.created, []);
});

test("concurrent label creation is tolerated but other API failures propagate", async () => {
  const f = fixture({
    files: [{ filename: "plugins/wt/app.ts" }],
    createError: {
      status: 422,
      response: {
        data: { errors: [{ resource: "Label", code: "already_exists" }] },
      },
    },
  });
  await autolabel(f);
  assert.equal(f.calls.added.length, 1);
  for (const error of [
    { status: 403 },
    {
      status: 422,
      response: { data: { errors: [{ resource: "Label", code: "invalid" }] } },
    },
  ]) {
    const failed = fixture({ createError: error });
    await assert.rejects(autolabel(failed), (actual) => actual === error);
    assert.equal(failed.calls.added.length, 0);
  }
});

test("API file limit fails before labels can be changed", async () => {
  const f = fixture({
    files: Array.from({ length: 3000 }, () => ({
      filename: "plugins/wt/file.ts",
    })),
  });
  await assert.rejects(autolabel(f), /3,000-file limit/);
  assert.deepEqual(f.calls.created, []);
  assert.deepEqual(f.calls.added, []);
});
