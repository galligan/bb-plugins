// Complete, schema-valid RPC results for the frontend harness tests.
import type { z } from "zod";
import type { inspectionSchema } from "../lib/host-contract.ts";
import type { OverviewRow } from "../lib/overview.ts";
import type { rpcContract } from "../server.ts";

export type Overview = z.infer<typeof rpcContract.overview.output>;
export type Rescues = z.infer<typeof rpcContract.rescues.output>;
type Inspection = z.infer<typeof inspectionSchema>;
type Thread = OverviewRow["threads"][number];
type Environment = NonNullable<OverviewRow["environment"]>;

export const project = { id: "proj_acme", name: "Acme" };

export function inspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    path: "/worktrees/acme/feat-login",
    branch: "feat/login",
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
    ...overrides,
  };
}

export function thread(overrides: Partial<Thread> = {}): Thread {
  return { id: "thr_login", title: "Fix login", archived: false, ...overrides };
}

const environment: Environment = {
  id: "env_login",
  projectId: project.id,
  status: "ready",
  retireAt: null,
  teardown: null,
};

/** A healthy worktree in use by one thread. */
export function presentRow(
  overrides: {
    pathKey?: string;
    inspection?: Partial<Inspection>;
    environment?: Partial<Environment> | null;
    projectId?: string;
    threads?: Thread[];
  } = {},
): OverviewRow {
  return {
    status: "present",
    pathKey: overrides.pathKey ?? "acme-feat-login",
    inspection: inspection(overrides.inspection),
    environment:
      overrides.environment === null
        ? null
        : { ...environment, ...overrides.environment },
    ...(overrides.projectId ? { projectId: overrides.projectId } : {}),
    threads: overrides.threads ?? [thread()],
  };
}

export function overview(
  rows: OverviewRow[],
  machine: { hostId?: string; name?: string; error?: string | null } = {},
): Overview {
  return {
    machines: [
      {
        hostId: machine.hostId ?? "host_mac",
        name: machine.name ?? "Mac",
        worktrees: rows,
        error: machine.error ?? null,
      },
    ],
    projects: [project],
  };
}

export const noRescues: Rescues = { projects: [] };
