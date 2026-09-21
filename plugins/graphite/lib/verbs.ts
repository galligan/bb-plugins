// The write path: `gt` verbs with the guard in front of them.
//
// Every verb refuses on a working tree that could lose work. That is the hazard
// `bb-plugin-dev` names — a restack or a sync over uncommitted work is not
// recoverable from inside BB — and the check comes from `environments.status`,
// never from a git call of our own.

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  resolveEnvironment,
  type CurrentStackRequest,
} from "./current-stack.ts";
import { graphiteHostContract } from "./host-contract.ts";

export type VerbName = "restack" | "submit" | "sync" | "merge";

/**
 * Working-tree states a write verb may run on. Everything else is refused,
 * including a state BB has not shipped yet: an allow-list fails closed, and a
 * guard that fails open on a name it does not recognise is not a guard.
 *
 * `untracked` is deliberately safe. A rebase does not touch untracked files, and
 * the one adjacent failure — an incoming commit wanting to write to an untracked
 * path — git aborts on itself before touching anything. Refusing there would fire
 * the guard where nothing can be lost, which teaches the operator that `--force`
 * is routine; by the time a genuinely dirty tree appears, `--force` is already a
 * reflex. A guard that cries wolf manufactures the habit that defeats it.
 */
const SAFE_STATES: ReadonlySet<string> = new Set(["clean", "untracked"]);

/** True when a write verb must refuse this working-tree state. */
export function blocksWrite(workingTree: string): boolean {
  return !SAFE_STATES.has(workingTree);
}

export interface VerbRequest extends CurrentStackRequest {
  readonly verb: VerbName;
  /** Extra `gt` arguments the caller parsed, already validated. */
  readonly args?: readonly string[];
  /** Proceed on a dirty tree. The caller must have asked for this explicitly. */
  readonly force?: boolean;
  readonly signal?: AbortSignal;
}

export type VerbOutcome =
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly outcome: "refused"; readonly reason: string }
  | { readonly outcome: "unavailable"; readonly reason: string };

/** `gt` verbs that ask before acting. `-f` is the only non-interactive answer. */
const FORCE_FLAG: Readonly<Record<VerbName, boolean>> = {
  restack: false,
  submit: false,
  sync: true,
  merge: false,
};

export async function runVerb(
  bb: BbPluginApi,
  request: VerbRequest,
): Promise<VerbOutcome> {
  const resolution = await resolveEnvironment(bb, request);
  if (resolution.outcome !== "resolved") {
    return { outcome: "unavailable", reason: resolution.reason };
  }
  const environment = resolution.environment;

  if (request.verb === "sync" && environment.isWorktree) {
    return {
      outcome: "refused",
      reason: "gt sync cannot run in a git worktree; fetch and restack instead",
    };
  }

  if (blocksWrite(environment.workingTree) && request.force !== true) {
    return {
      outcome: "refused",
      reason:
        `working tree is ${environment.workingTree}; ` +
        `commit or stash first, or pass --force to proceed anyway`,
    };
  }

  const args = [request.verb, ...(request.args ?? [])];
  if (FORCE_FLAG[request.verb]) args.push("-f");

  let result;
  try {
    result = await bb.hosts
      .experimental_client({ contract: graphiteHostContract })
      .call(
        "gt",
        { cwd: environment.path, args },
        {
          hostId: environment.hostId,
          signal: request.signal,
          timeoutMs: 125_000,
        },
      );
  } catch {
    return { outcome: "unavailable", reason: "workspace host is unavailable" };
  }
  if (result.outcome === "not_found") {
    return {
      outcome: "unavailable",
      reason: `the gt binary was not found; looked in ${result.tried.join(", ")}`,
    };
  }
  if (result.outcome === "failed") {
    return {
      outcome: "unavailable",
      reason: `gt could not be run: ${result.message}`,
    };
  }
  return {
    outcome: "ran",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
