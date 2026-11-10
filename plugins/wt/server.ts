// bb-plugin-wt — registers the "Worktree+" environment provider.
//
// bb core owns launch attempts, retries, attachment and retirement. This file
// only maps core's create/remove calls onto the host entry, which does the
// git, file and script work on the machine that owns the checkout.

import {
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { z } from "zod";

import {
  branchName,
  DEFAULT_BRANCH_PREFIX,
  isValidBranchPrefix,
} from "./lib/branch-name.ts";
import { hostContract, hostSignals } from "./lib/host-contract.ts";
import { renderWorktree } from "./lib/render.ts";
import {
  DEFAULT_RETIRE_GRACE_MINUTES,
  isValidGraceMinutes,
  retireGraceMs,
} from "./lib/retire.ts";

import {
  projectContract,
  projectHandlers,
  projectSettingsStore,
} from "./project-settings.ts";
import { effectiveBranchSettings } from "./lib/project-settings.ts";
import { managementContract, managementHandlers } from "./management.ts";

export const PROVIDER_ID = "wt";
const PLUGIN_ID = "wt";

/** Setup scripts get 15 minutes; leave headroom for git and file copies. */
const HOST_CALL_TIMEOUT_MS = 20 * 60 * 1000;

export const inputsSchema = z
  .strictObject({
    /** Branch or ref the new branch starts from; omitted uses the default branch. */
    base: z.string().min(1).optional(),
  })
  .default({});

/** Calls the frontend makes to this plugin's server. */
export const rpcContract = defineRpcContract({
  ...managementContract,
  ...projectContract,
  /** The base a new worktree starts from when none is picked. */
  defaultBase: {
    input: z.strictObject({
      projectId: z.string().min(1),
      hostId: z.string().min(1),
    }),
    output: z.strictObject({ base: z.string().min(1).nullable() }),
  },
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default async function wtPlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });

  const settings = bb.settings.define({
    prefixBranches: {
      type: "boolean",
      label: "Prefix worktree branches",
      description: `Start every new worktree branch with a prefix: the one below, else bb's own branch prefix, else "${DEFAULT_BRANCH_PREFIX}". Turn off to use bb's suggested name unchanged.`,
      default: true,
    },
    branchPrefix: {
      type: "string",
      label: "Branch prefix",
      description: `Used in place of bb's branch prefix for Worktree+ branches, for example "wt/". Leave empty to use bb's, or "${DEFAULT_BRANCH_PREFIX}" when bb has none.`,
      experimental_schema: z
        .string()
        .refine(isValidBranchPrefix, "Not a valid start for a git branch name"),
      default: "",
    },
    retireWhenArchived: {
      type: "boolean",
      label: "Remove worktrees after their threads are archived",
      description:
        "Once every thread using a worktree is archived or deleted, remove the worktree after the grace period below. The branch is kept and uncommitted work is saved first. Turn off to keep worktrees until their environment is deleted.",
      default: true,
    },
    retireGraceMinutes: {
      type: "number",
      label: "Grace period before removal (minutes)",
      description:
        "How long a worktree stays after its last thread is archived. Unarchiving a thread within this time keeps the worktree.",
      experimental_schema: z
        .number()
        .refine(isValidGraceMinutes, "Must be zero or more minutes"),
      default: DEFAULT_RETIRE_GRACE_MINUTES,
    },
  });
  const retirement = (values: {
    retireWhenArchived: boolean;
    retireGraceMinutes: number;
  }) =>
    retireGraceMs({
      enabled: values.retireWhenArchived,
      minutes: values.retireGraceMinutes,
    });
  const graceMs = retirement(await settings.get());
  // bb reads a provider's policy once, at registration. Reload so a changed
  // setting takes effect without restarting bb.
  settings.onChange((next) => {
    if (retirement(next) !== graceMs) {
      void bb.sdk.plugins.reload({ pluginId: PLUGIN_ID });
    }
  });

  const projectStore = projectSettingsStore(bb);

  const reports = new Map<string, PluginEnvironmentProviderProgress>();
  host.experimental_onSignal("progress", ({ payload }) => {
    const report = reports.get(payload.operationId);
    if (report === undefined) return;
    if (payload.kind === "step") report.step(payload.text);
    else report.log(payload.text);
  });

  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "Worktree+",
    description:
      "Create a Git worktree under ~/.worktrees, set up from the repo's own scripts.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: inputsSchema,
    // A thread holds its worktree until it is archived or deleted, so one
    // that is still in use never disappears on this timer.
    policy: { retireGraceMs: graceMs },

    async create(context) {
      const hostId = context.host.id;
      const [global, project, config] = await Promise.all([
        settings.get(),
        projectStore.read(context.thread.projectId),
        bb.sdk.system.config(),
      ]);
      const { prefixBranches, branchPrefix } = effectiveBranchSettings(
        global,
        project,
      );
      const resolved = await host.call(
        "resolve",
        {
          scripts: project?.scripts ?? null,
          pathKey: context.pathKey,
          sourcePath: context.projectCheckout.path,
          branchName: branchName({
            suggested: context.suggestedBranchName,
            bbPrefix: config.generalSettings.managedBranchPrefix,
            pluginPrefix: branchPrefix,
            enabled: prefixBranches,
          }),
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
        bb.realtime.publish("worktrees-changed", null);
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
        bb.realtime.publish("worktrees-changed", null);
      }
    },
  });

  bb.rpc.register(rpcContract, {
    ...managementHandlers(bb, host),
    ...projectHandlers(bb, host, projectStore, () => settings.get()),
    async defaultBase({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const source = project.sources.find(
        (candidate) =>
          candidate.type === "local_path" && candidate.hostId === hostId,
      );
      return source === undefined
        ? { base: null }
        : host.call("defaultBase", { sourcePath: source.path }, { hostId });
    },
  });

  bb.cli.register(
    defineCli({
      name: "wt",
      summary:
        "Worktree+: list managed worktrees and what removing each would lose",
      commands: {
        list: cliCommand({
          summary:
            "List every Worktree+ worktree on each connected machine, marked SAFE or UNSAVED with the reasons",
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
                ).worktrees.map(
                  ({ sourcePath: _sourcePath, ...entry }) => entry,
                ),
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
                  ? "No Worktree+ worktrees."
                  : blocks.join("\n\n"),
            };
          },
        }),
      },
    }),
  );
}
