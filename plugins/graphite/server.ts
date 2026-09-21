// bb-plugin-graphite — the plugin's backend.
//
// Three surfaces over one collector, so they cannot disagree:
//
//   - `stack_current` RPC, which the thread header and panel render
//   - `bb graphite …`, for a terminal and for agents through the generated
//     plugin-commands skill
//   - a `graphite_stack` agent tool, for a thread that wants the snapshot
//     without shelling out
//
// The read path never invokes `gt`: any `gt` command silently refreshes the
// metadata it would be read from, which destroys the one signal `gt` cannot
// report. See docs/agents/graphite.md.

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { currentStack } from "./lib/current-stack.ts";
import { renderStack } from "./lib/render-stack.ts";
import { submitArgs } from "./lib/submit-args.ts";
import { runVerb, type VerbName } from "./lib/verbs.ts";

const threadSchema = z.object({ id: z.string(), title: z.string() });

const stackedSchema = z.object({
  outcome: z.literal("stacked"),
  branch: z.string(),
  position: z.number(),
  total: z.number(),
  placement: z.enum(["top", "middle", "bottom"]),
  needsRestack: z.boolean(),
  isStale: z.boolean(),
  workingTree: z.string().nullable(),
  warnings: z.array(z.string()),
  branches: z.array(
    z.object({
      name: z.string(),
      isCurrent: z.boolean(),
      needsRestack: z.boolean(),
      isStale: z.boolean(),
      threads: z.array(threadSchema),
      offshoots: z.array(
        z.object({
          name: z.string(),
          column: z.number(),
          parent: z.string().nullable(),
          needsRestack: z.boolean(),
          isStale: z.boolean(),
          threads: z.array(threadSchema),
        }),
      ),
    }),
  ),
});

export const rpcContract = defineRpcContract({
  stack_current: {
    input: z.object({
      projectId: z.string(),
      threadId: z.string().nullable().optional(),
    }),
    output: z.discriminatedUnion("outcome", [
      stackedSchema,
      z.object({ outcome: z.literal("none"), reason: z.string() }),
    ]),
  },
});

const WRITE_VERBS: readonly VerbName[] = ["restack", "submit", "sync", "merge"];

const USAGE = [
  "Usage:",
  "  bb graphite stack [--json]      the stack around the checked-out branch",
  "  bb graphite restack [--force]   rebase the stack onto its parents",
  "  bb graphite submit [options]    push the stack and open or update its PRs",
  "  bb graphite sync [--force]      pull trunk, restack, drop merged branches",
  "  bb graphite merge [--force]     merge the stack in order",
  "",
  "submit options:",
  "  --publish            publish submitted PRs; new PRs default to drafts",
  "  --merge-when-ready   let each PR merge once its checks pass",
  "  --update-only        push and update PRs that already exist; open none",
  "",
  "Acts on the current thread's environment. Outside a thread, name one with",
  "--project <id> or --thread <id>. Projects with multiple environments need",
  "an explicit thread.",
  "",
  "A write verb refuses a working tree that could lose work — dirty_uncommitted,",
  "committed_unmerged, dirty_and_committed_unmerged, or a state it does not",
  "recognise — unless you pass --force. clean and untracked proceed.",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    stack_current: ({ projectId, threadId }) =>
      currentStack(bb, { projectId, threadId: threadId ?? null }),
  });

  bb.agents.registerTool({
    name: "graphite_stack",
    description:
      "Read the Graphite stack around the branch this thread's environment has " +
      "checked out: position, what needs a restack, what hangs off each branch, " +
      "and which threads are working on them.",
    instructions:
      "Use graphite_stack instead of running `gt log` or `gt ls`. Those commands " +
      "refresh Graphite's own metadata as a side effect, which destroys the " +
      "staleness signal this tool reports.",
    presentation: {
      label: {
        pending: "Reading the Graphite stack",
        completed: "Read the Graphite stack",
      },
    },
    parameters: z.object({}),
    async execute(_input, { threadId, projectId }) {
      if (projectId == null) {
        return {
          content: [{ type: "text", text: "No project for this thread." }],
          isError: true,
        };
      }
      const stack = await currentStack(bb, {
        projectId,
        threadId: threadId ?? null,
      });
      return renderStack(stack);
    },
  });

  bb.cli.register({
    name: "graphite",
    summary: "Read and drive the Graphite stack for this project",
    commands: [
      {
        name: "stack",
        summary: "Show the stack around the checked-out branch",
        usage: "bb graphite stack [--json]",
      },
      {
        name: "restack",
        summary: "Rebase the stack onto its parents",
        usage: "bb graphite restack [--force]",
      },
      {
        name: "submit",
        summary:
          "Push the stack and open or update its PRs. New PRs are drafts unless --publish",
        usage:
          "bb graphite submit [--publish] [--merge-when-ready] [--update-only] [--force]",
      },
      {
        name: "sync",
        summary: "Pull trunk, restack, drop merged branches",
        usage: "bb graphite sync [--force]",
      },
      {
        name: "merge",
        summary: "Merge the stack in order",
        usage: "bb graphite merge [--force]",
      },
    ],
    async run(argv, ctx) {
      const [command, ...rest] = argv;
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: USAGE };
      }
      // A leading flag means no command was given. Saying "unknown command: --project"
      // sends the reader looking for a command by that name.
      if (command.startsWith("-")) {
        return { exitCode: 1, stderr: `No command given.\n\n${USAGE}` };
      }
      let json = false;
      let force = false;
      let projectFlag: string | null = null;
      let threadFlag: string | null = null;
      const passthrough: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--json") json = true;
        else if (arg === "--force") force = true;
        else if (arg === "--project" || arg === "--thread") {
          const value = rest[++i];
          if (value === undefined || value.startsWith("-")) {
            return { exitCode: 1, stderr: `${arg} needs an id.` };
          }
          if (arg === "--project") projectFlag = value;
          else threadFlag = value;
        } else passthrough.push(arg);
      }
      if (json && command !== "stack") {
        return { exitCode: 1, stderr: "--json is only supported by stack." };
      }
      const targetThreadId = threadFlag ?? ctx.threadId ?? null;
      let projectId = projectFlag ?? ctx.projectId ?? null;
      if (projectId === null && targetThreadId !== null) {
        const thread = await bb.sdk.threads
          .get({ threadId: targetThreadId })
          .catch(() => null);
        projectId = thread?.projectId ?? null;
      }
      if (projectId == null) {
        return {
          exitCode: 1,
          stderr:
            "Run this inside a project or a thread, or pass --project <id>.",
        };
      }
      // An explicit --project overrides the invoking thread: that thread belongs to
      // whichever BB instance the shell is bound to, which need not be this one.
      const request = {
        projectId,
        threadId:
          threadFlag ?? (projectFlag === null ? (ctx.threadId ?? null) : null),
      };

      if (command === "stack") {
        const stack = await currentStack(bb, request);
        // Same exit code either way: a caller testing `bb graphite stack` should not
        // get a different answer for asking in JSON.
        const exitCode = stack.outcome === "stacked" ? 0 : 1;
        if (json) return { exitCode, stdout: JSON.stringify(stack, null, 2) };
        return { exitCode, stdout: renderStack(stack) };
      }

      const verb = WRITE_VERBS.find((candidate) => candidate === command);
      if (verb === undefined) {
        return {
          exitCode: 1,
          stderr: `Unknown command: ${command}\n\n${USAGE}`,
        };
      }

      const submitted = verb === "submit" ? submitArgs(passthrough) : null;
      if (submitted !== null && !submitted.ok) {
        return { exitCode: 1, stderr: submitted.error };
      }

      const result = await runVerb(bb, {
        ...request,
        verb,
        args: submitted?.args ?? passthrough,
        force,
        signal: ctx.signal,
      });
      if (result.outcome === "refused") {
        return { exitCode: 1, stderr: `Refused: ${result.reason}` };
      }
      if (result.outcome === "unavailable") {
        return { exitCode: 1, stderr: result.reason };
      }
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  });
}
