import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceDefinition } from "../sets-schema.ts";
import { LIMITS, type Json } from "../json.ts";
import {
  SourceFailure,
  sourceValue,
  type SourceSdk,
  type SourceResult,
} from "./contracts.ts";

// Public bb--git projections, checked with `bb plugin rpc inspect` on BB 0.49.0.
// Unknown fields (including eager patches and commit subjects) are not evidence.
const count = z.number().int().nonnegative().safe();
const text = z.string();
const file = z.object({
  path: text.min(1),
  previousPath: text.min(1).nullable(),
  changeKind: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "type_changed",
  ]),
  additions: count,
  deletions: count,
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  revision: text.min(1),
});
const statusFile = z.object({
  path: text.min(1),
  status: z.enum(["M", "A", "D", "R", "C", "U", "??", "?"]),
  insertions: count.nullable(),
  deletions: count.nullable(),
});
const summary = z.object({
  insertions: count,
  deletions: count,
  lineStatsComplete: z.boolean(),
  fileCount: count,
  files: z.array(statusFile),
});
const checkout = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("branch"),
    branchName: text.min(1),
    headSha: text.min(1).nullable(),
  }),
  z.object({ kind: z.literal("detached"), headSha: text.min(1).nullable() }),
  z.object({ kind: z.literal("unborn"), branchName: text.min(1).nullable() }),
  z.object({ kind: z.literal("unknown"), reason: text.min(1) }),
]);
const workspaceSchema = z.object({
  checkout,
  workingTree: summary.extend({
    hasUncommittedChanges: z.boolean(),
    state: z.enum([
      "clean",
      "untracked",
      "dirty_uncommitted",
      "committed_unmerged",
      "dirty_and_committed_unmerged",
    ]),
  }),
  mergeBase: summary
    .extend({
      mergeBaseBranch: text.min(1),
      baseRef: text.nullable(),
      aheadCount: count,
      behindCount: count,
      squashMergeCheckComplete: z.boolean(),
      hasCommittedUnmergedChanges: z.boolean(),
    })
    .nullable(),
});
const filesSchema = z.object({
  files: z.array(file),
  truncated: z.boolean(),
  shortstat: text,
  mergeBaseRef: text.nullable(),
});
const diffSchema = z.object({
  diff: text,
  truncated: z.boolean(),
  shortstat: text,
  files: text,
  mergeBaseRef: text.nullable(),
});
const envelope = z.object({
  outcome: z.enum(["available", "not_applicable", "unavailable"]),
});
const MAX_FILES = 1000;
function boundFiles(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_FILES)
    throw new SourceFailure("git_file_count", "too_large");
}

/** Only explicit environment reads. bb--git routes to the host without waking it. */
export async function readGit(
  sdk: SourceSdk,
  definition: SourceDefinition,
  environmentId: string | undefined,
  signal: AbortSignal,
): Promise<SourceResult> {
  if (!environmentId) throw new SourceFailure("environment_required");
  const target: Json =
    definition.target === "branch"
      ? { type: "branch_committed", mergeBaseBranch: definition.base! }
      : { type: "uncommitted" };
  const method =
    definition.from === "git.status"
      ? "workspaceStatus"
      : definition.from === "git.changedFiles"
        ? "files"
        : "diff";
  const raw = await sdk.plugins.callRpc({
    pluginId: "bb--git",
    method,
    input:
      method === "workspaceStatus"
        ? {
            environmentId,
            ...(definition.target === "branch"
              ? { mergeBaseBranch: definition.base! }
              : {}),
          }
        : {
            environmentId,
            target,
            ...(method === "files"
              ? { ignoreWhitespace: false }
              : {
                  maxDiffBytes: LIMITS.inputBytes,
                  maxFileListBytes: LIMITS.inputBytes,
                }),
          },
    signal,
    outputSchema: z.unknown(),
  });
  const outcome = envelope.parse(raw).outcome;
  if (outcome !== "available")
    throw new SourceFailure(
      outcome === "not_applicable" ? "git_not_applicable" : "git_unavailable",
    );
  const selected = z
    .object({ workspace: z.unknown(), diff: z.unknown() })
    .partial()
    .parse(raw);
  const selection = {
    target: definition.target!,
    environmentId,
    ...(definition.base === undefined ? {} : { base: definition.base }),
  };
  if (method === "workspaceStatus") {
    // Bound both arrays before parsing, even though only the requested summary is returned.
    const arrays = z
      .object({
        workingTree: z.object({ files: z.unknown() }),
        mergeBase: z.object({ files: z.unknown() }).nullable(),
      })
      .parse(selected.workspace);
    boundFiles(arrays.workingTree.files);
    boundFiles(arrays.mergeBase?.files);
    const workspace = workspaceSchema.parse(selected.workspace);
    if (workspace.checkout.kind === "unknown")
      throw new SourceFailure("git_checkout_unknown");
    const changes =
      definition.target === "branch"
        ? workspace.mergeBase
        : workspace.workingTree;
    if (!changes) throw new SourceFailure("git_base_unavailable");
    if (
      "mergeBaseBranch" in changes &&
      changes.mergeBaseBranch !== definition.base
    )
      throw new SourceFailure("git_base_mismatch");
    // workspaceStatus has no truncation flag. A partial list is not a complete observation.
    if (changes.files.length !== changes.fileCount)
      throw new SourceFailure("git_status_files_incomplete");
    const revision =
      "headSha" in workspace.checkout ? workspace.checkout.headSha : null;
    return sourceValue(
      {
        environmentId,
        target: definition.target!,
        checkout: workspace.checkout,
        changes,
      },
      definition,
      true,
      {
        selection: {
          ...selection,
          count: changes.files.length,
          truncated: false,
        },
        ...(revision && revision.length <= 128 ? { revision } : {}),
      },
    );
  }
  if (method === "files") {
    boundFiles(z.object({ files: z.unknown() }).parse(raw).files);
    const files = filesSchema.parse(raw);
    // Digest identifies this observed path/revision list, not an atomic Git checkout.
    const revision = createHash("sha256")
      .update(JSON.stringify(files.files.map((f) => [f.path, f.revision])))
      .digest("hex");
    return sourceValue(
      { environmentId, target: definition.target!, ...files },
      definition,
      true,
      {
        selection: {
          ...selection,
          count: files.files.length,
          truncated: files.truncated,
        },
        revision,
      },
    );
  }
  const diff = diffSchema.parse(selected.diff);
  return sourceValue(
    { environmentId, target: definition.target!, ...diff },
    definition,
    true,
    {
      selection: { ...selection, truncated: diff.truncated },
    },
  );
}
