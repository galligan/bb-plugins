import { z } from "zod";
import { listedWorktreeSchema } from "./host-contract.ts";
import type { Inspection } from "./inspect.ts";

const teardown = z.object({
  status: z.string(),
  message: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});
export const environmentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  hostId: z.string(),
  environmentProviderInstanceKey: z.string().nullable(),
  status: z.string(),
  path: z.string().nullable(),
  lifecycle: z.object({
    retireAt: z.number().nullable(),
    teardown: teardown.nullable(),
  }),
});
export const threadSchema = z.object({
  id: z.string(),
  title: z
    .string()
    .nullable()
    .transform((v) => v ?? "Untitled thread"),
  archived: z.boolean(),
  environmentId: z.string().nullable(),
});
export const rowEnvironmentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.string(),
  retireAt: z.number().nullable(),
  teardown: teardown.nullable(),
});
export const overviewRowSchema = listedWorktreeSchema.and(
  z.object({
    environment: rowEnvironmentSchema.nullable(),
    projectId: z.string().optional(),
    threads: z.array(threadSchema.omit({ environmentId: true })),
  }),
);
export type OverviewRow = z.infer<typeof overviewRowSchema>;
export const machineSchema = z.object({
  hostId: z.string(),
  name: z.string(),
  worktrees: z.array(overviewRowSchema),
  error: z.string().nullable(),
});
type Environment = z.infer<typeof environmentSchema>;
type Thread = z.infer<typeof threadSchema>;
type Machine = {
  hostId: string;
  name: string;
  worktrees: z.infer<typeof listedWorktreeSchema>[];
  error: string | null;
};

/** Match keys only within their host; absent records remain visible and fail closed. */
export function joinOverview(
  machines: Machine[],
  environments: Environment[],
  threads: Thread[],
): z.infer<typeof machineSchema>[] {
  return machines.map((machine) => {
    const onHost = environments.filter((env) => env.hostId === machine.hostId);
    const records = [...machine.worktrees];
    if (machine.error === null)
      for (const env of onHost) {
        if (
          env.status === "destroyed" ||
          env.environmentProviderInstanceKey === null ||
          env.path === null
        )
          continue;
        if (
          !records.some(
            (record) => record.pathKey === env.environmentProviderInstanceKey,
          )
        )
          records.push({
            status: "unreadable",
            pathKey: env.environmentProviderInstanceKey,
            path: env.path,
            message: "No Worktree+ record exists for this bb environment.",
          });
      }
    return {
      ...machine,
      worktrees: records.map((record) => {
        const env =
          onHost.find(
            (candidate) =>
              candidate.environmentProviderInstanceKey === record.pathKey &&
              candidate.status !== "destroyed",
          ) ??
          onHost.find(
            (candidate) =>
              candidate.environmentProviderInstanceKey === record.pathKey,
          );
        return {
          ...record,
          environment:
            env === undefined
              ? null
              : {
                  id: env.id,
                  projectId: env.projectId,
                  status: env.status,
                  ...env.lifecycle,
                },
          threads:
            env === undefined
              ? []
              : threads
                  .filter((thread) => thread.environmentId === env.id)
                  .map(({ id, title, archived }) => ({ id, title, archived })),
        };
      }),
    };
  });
}

export function rowState(
  row: OverviewRow,
  now: number,
): {
  kind: "attention" | "retiring" | "in-use" | "orphaned";
  badge: string | null;
} {
  if (row.environment?.teardown?.status === "failed")
    return {
      kind: "attention",
      badge: row.environment.teardown.message ?? "Removal failed",
    };
  if (row.status !== "present")
    return {
      kind: "attention",
      badge:
        row.status === "missing" ? "The folder no longer exists" : row.message,
    };
  if (
    row.environment?.retireAt !== null &&
    row.environment?.retireAt !== undefined &&
    row.environment.retireAt > now
  )
    return {
      kind: "retiring",
      badge: `Removes in ${String(Math.ceil((row.environment.retireAt - now) / 60000))}m`,
    };
  return row.environment === null
    ? { kind: "orphaned", badge: "No bb environment" }
    : { kind: "in-use", badge: null };
}
const rank = { attention: 0, retiring: 1, "in-use": 2, orphaned: 3 };
export function sortRows(rows: OverviewRow[], now: number): OverviewRow[] {
  const activity = (row: OverviewRow) =>
    row.status === "present" ? (row.inspection.lastActivity ?? 0) : 0;
  return [...rows].sort(
    (a, b) =>
      rank[rowState(a, now).kind] - rank[rowState(b, now).kind] ||
      activity(b) - activity(a) ||
      a.pathKey.localeCompare(b.pathKey),
  );
}

/** Mirrors the host's refusal fields; these are never candidates for a rescue. */
export function removalConsequences(inspection: Inspection): {
  saved: string[];
  blocked: string[];
} {
  const saved: string[] = [],
    blocked: string[] = [];
  if (inspection.changedFiles > 0)
    saved.push("Uncommitted tracked files will be saved to a rescue ref.");
  if (inspection.untrackedFiles > 0)
    saved.push("Untracked files will be saved to a rescue ref.");
  if (inspection.unreferencedHead)
    saved.push("Detached commits will be kept by a rescue ref.");
  if (inspection.editedSharedFiles.length > 0)
    blocked.push(
      `Edited ignored files block removal: ${inspection.editedSharedFiles.join(", ")}`,
    );
  if (inspection.conflictedFiles > 0)
    blocked.push("Unresolved conflicts block removal.");
  if (inspection.operation !== null)
    blocked.push(`A ${inspection.operation} in progress blocks removal.`);
  if (inspection.unsavedSubmodules.length > 0)
    blocked.push(
      `Unsaved submodule work blocks removal: ${inspection.unsavedSubmodules.join(", ")}`,
    );
  return { saved, blocked };
}
