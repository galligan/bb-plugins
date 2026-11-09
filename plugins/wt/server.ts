// bb-plugin-wt — registers the "Worktrees+" environment provider.
//
// bb core owns launch attempts, retries, attachment and retirement. This file
// only maps core's create/remove calls onto the host entry, which does the
// git, file and script work on the machine that owns the checkout.

import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { z } from "zod";

import { hostContract, hostSignals } from "./lib/host-contract.ts";
import { renderWorktree } from "./lib/render.ts";

export const PROVIDER_ID = "wt";

/** Setup scripts get 15 minutes; leave headroom for git and file copies. */
const HOST_CALL_TIMEOUT_MS = 20 * 60 * 1000;

export const inputsSchema = z
  .strictObject({
    /** Branch or ref the new branch starts from; omitted uses the default branch. */
    base: z.string().min(1).optional(),
  })
  .default({});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default async function wtPlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });

  const reports = new Map<string, PluginEnvironmentProviderProgress>();
  host.experimental_onSignal("progress", ({ payload }) => {
    const report = reports.get(payload.operationId);
    if (report === undefined) return;
    if (payload.kind === "step") report.step(payload.text);
    else report.log(payload.text);
  });

  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "Worktrees+",
    description:
      "Create a Git worktree under ~/.worktrees, set up from the repo's own scripts.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: inputsSchema,
    // Keep worktrees until their environment is deleted explicitly, so a
    // worktree someone is still using never disappears on a timer.
    policy: { retireGraceMs: null },

    async create(context) {
      const hostId = context.host.id;
      const resolved = await host.call(
        "resolve",
        {
          pathKey: context.pathKey,
          sourcePath: context.projectCheckout.path,
          branchName: context.suggestedBranchName,
          base: context.inputs.base ?? null,
        },
        { hostId, signal: context.signal },
      );
      if (resolved.status === "failed") return resolved;
      if (!(await context.experimental_claimPath(resolved.path))) {
        return {
          status: "failed",
          message: `${resolved.path} is already in use by another environment.`,
        };
      }

      const operationId = `create#${context.pathKey}#${String(context.attempt)}`;
      reports.set(operationId, context.report);
      try {
        const created = await host.call(
          "create",
          { operationId, pathKey: context.pathKey },
          { hostId, signal: context.signal, timeoutMs: HOST_CALL_TIMEOUT_MS },
        );
        if (created.status === "failed") return created;
        return {
          status: "created",
          path: created.path,
          ownsPath: true,
          mergeBaseBranch: created.mergeBaseBranch,
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: messageOf(error) };
      } finally {
        reports.delete(operationId);
      }
    },

    async remove(context) {
      if (context.hostId === null) {
        return {
          status: "failed",
          message: "The worktree's machine is unknown.",
        };
      }
      const operationId = `remove#${context.pathKey}#${String(context.attempt)}`;
      reports.set(operationId, context.report);
      try {
        return await host.call(
          "remove",
          { operationId, pathKey: context.pathKey, path: context.path },
          {
            hostId: context.hostId,
            signal: context.signal,
            timeoutMs: HOST_CALL_TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: messageOf(error) };
      } finally {
        reports.delete(operationId);
      }
    },
  });

  bb.cli.register(
    defineCli({
      name: "wt",
      summary:
        "Worktrees+: list managed worktrees and what removing each would lose",
      commands: {
        list: cliCommand({
          summary:
            "List every Worktrees+ worktree on each connected machine, marked SAFE or UNSAVED with the reasons",
          options: {
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          async run(input, ctx) {
            const hosts = (
              await bb.sdk.hosts.list({ signal: ctx.signal })
            ).filter((candidate) => candidate.status === "connected");
            const machines = await Promise.all(
              hosts.map(async (machine) => ({
                machine: machine.name,
                worktrees: (
                  await host.call(
                    "list",
                    {},
                    { hostId: machine.id, signal: ctx.signal },
                  )
                ).worktrees,
              })),
            );
            if (input.options.json === true) {
              return { exitCode: 0, stdout: JSON.stringify(machines, null, 2) };
            }
            const now = Date.now();
            const blocks = machines.flatMap(({ machine, worktrees }) => [
              ...(machines.length > 1 ? [`# ${machine}`] : []),
              ...worktrees.map((entry) => renderWorktree(entry, now)),
            ]);
            return {
              exitCode: 0,
              stdout:
                blocks.length === 0
                  ? "No Worktrees+ worktrees."
                  : blocks.join("\n\n"),
            };
          },
        }),
      },
    }),
  );
}
