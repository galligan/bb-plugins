// bb-plugin-wt — runs on the machine that owns the checkout. All git, file and
// script work happens here; the server only orchestrates.

import { homedir } from "node:os";
import { join } from "node:path";

import {
  experimental_defineHostEntry,
  experimental_killProcessesWithCwdUnder,
} from "@get-bb/plugin-sdk/host";

import { hostContract, hostSignals } from "./lib/host-contract.ts";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  resolveWorktree,
  type HostEnvironment,
} from "./lib/worktree.ts";

// Outside ~/.bb on purpose: that is bb's own data folder, and bb may delete
// what it finds there.
const worktreeRoot = (): string => join(homedir(), ".worktrees");

interface CallContext {
  signal: AbortSignal;
  experimental_paths: { dataDir: string };
}

const quiet = (context: CallContext): HostEnvironment => ({
  root: worktreeRoot(),
  dataDir: context.experimental_paths.dataDir,
  signal: context.signal,
  report: () => {},
});

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    resolve: (input, context) => resolveWorktree(quiet(context), input),
    create: ({ operationId, pathKey }, context) =>
      createWorktree(reporting(operationId, context), { pathKey }),
    remove: ({ operationId, pathKey, path }, context) =>
      removeWorktree(reporting(operationId, context), { pathKey, path }),
    list: async (_input, context) => ({
      worktrees: await listWorktrees(quiet(context)),
    }),
  },
});

function reporting(
  operationId: string,
  context: CallContext & {
    experimental_emitSignal: (
      signal: "progress",
      payload: { operationId: string; kind: "step" | "log"; text: string },
    ) => Promise<void>;
  },
): HostEnvironment {
  return {
    ...quiet(context),
    report: (kind, text) => {
      // Progress is best effort; a dropped line must not fail the operation.
      void context
        .experimental_emitSignal("progress", { operationId, kind, text })
        .catch(() => {});
    },
    killProcessesUnder: (directory) =>
      experimental_killProcessesWithCwdUnder({ directories: [directory] }),
  };
}
