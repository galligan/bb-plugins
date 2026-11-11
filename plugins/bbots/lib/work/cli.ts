import { cliCommand, PluginCliError } from "@get-bb/plugin-sdk";
import { randomUUID } from "node:crypto";
import type { SetupStore } from "../setup/storage.ts";
import { agreementSchema, workSchema } from "./contracts.ts";
import type { Routing } from "./routing.ts";
import type { WorkService } from "./service.ts";
import type { WorkStore } from "./storage.ts";

const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const author = {
  type: "string",
  required: true,
  description: "Truthful person or agent requesting this change",
} as const;
const reason = {
  type: "string",
  required: true,
  description: "Explicit instruction motivating this change",
} as const;
const conversation = [
  {
    name: "conversationId",
    required: true,
    description: "Stable owned logical conversation ID",
  },
] as const;
const message = [
  {
    name: "message",
    required: true,
    description: "Explicit communication, at most 16,000 characters",
  },
] as const;
const result = (value: unknown, failed = false) => ({
  exitCode: failed ? 1 : 0,
  stdout: JSON.stringify(value, null, 2) + "\n",
});

export function workCommands(
  store: SetupStore,
  work: WorkStore,
  service: WorkService,
  routing: Routing,
  changed: () => void,
) {
  return {
    work: cliCommand({
      summary:
        "Start one owned normal worker with an explicit assignment and persisted reporting contract",
      positionals: [
        {
          name: "assignment",
          required: true,
          description: "Bounded explicit assignment",
        },
      ],
      options: {
        bot: {
          type: "string",
          description:
            "Required when the caller is not an owned bot conversation",
        },
        title: {
          type: "string",
          required: true,
          description: "Short task title for → @Bot <task>",
        },
        project: {
          type: "string",
          required: true,
          description: "Native project containing the working environment",
        },
        environment: {
          type: "string",
          required: true,
          description: "Existing ready environment; no home relocation",
        },
        parent: {
          type: "string",
          description:
            "Optional native parent in this project; independent of report target",
        },
        "parent-notifications": {
          type: "enum",
          values: ["off", "auto"],
          default: "off",
          description:
            "Native notifications; auto can duplicate explicit contract reports",
        },
        "report-thread": {
          type: "string",
          description:
            "Explicit ordinary physical report target; mutually exclusive with report-conversation",
        },
        "report-conversation": {
          type: "string",
          description:
            "Stable logical report target; default is this bot's main",
        },
        "report-when": {
          type: "string",
          description:
            "Human-readable triggers evaluated by the worker, not a subscription engine",
        },
        "stop-when": {
          type: "string",
          description: "Assignment stop conditions",
        },
        context: { type: "string", description: "Bounded selected context" },
        source: {
          type: "string",
          repeatable: true,
          description: "Evidence/context reference; repeat up to20",
        },
        "request-id": {
          type: "string",
          description:
            "Retained UUID; same request never automatically respawns uncertain work",
        },
        author,
        reason,
        json,
      },
      async run({ positionals, options }, ctx) {
        const owner = ctx.threadId
          ? store.conversations.ownerOfThread(ctx.threadId)
          : null;
        const botId = options.bot ?? owner?.botId;
        if (!botId)
          throw new PluginCliError(
            "Unowned caller must select --bot explicitly.",
            { code: "unowned_caller" },
          );
        if (options["report-thread"] && options["report-conversation"])
          throw new PluginCliError("Choose only one report destination.", {
            code: "ambiguous_destination",
          });
        const input = workSchema.parse({
          requestId: options["request-id"] ?? randomUUID(),
          botId,
          title: options.title,
          projectId: options.project,
          environmentId: options.environment,
          parentThreadId: options.parent,
          parentNotifications: options["parent-notifications"],
          author: options.author,
          reason: options.reason,
          agreement: {
            assignment: positionals.assignment,
            context: options.context,
            sources: options.source,
            reportWhen: options["report-when"],
            stopWhen: options["stop-when"],
            reportTo: options["report-thread"]
              ? { kind: "thread", threadId: options["report-thread"] }
              : {
                  kind: "conversation",
                  conversationId:
                    options["report-conversation"] ?? store.view(botId).main.id,
                },
          },
        });
        const view = await service.create(input, ctx.threadId, ctx.signal);
        return result(view, !!view.setup.error || view.setup.phase !== "bound");
      },
    }),
    "work show": cliCommand({
      summary:
        "Inspect persisted worker intent, ownership and current reporting contract; starts no work",
      positionals: conversation,
      options: { json },
      run: ({ positionals }) =>
        result(service.view(positionals.conversationId)),
    }),
    "work list": cliCommand({
      summary:
        "List up to100 owned workers and recover their recorded creation receipts; starts no work",
      positionals: [
        { name: "botId", required: true, description: "Stable bot ID" },
      ],
      options: { json },
      run: ({ positionals }) => result(work.list(positionals.botId)),
    }),
    "contract show": cliCommand({
      summary: "Read the current revisioned agreement; no destination fallback",
      positionals: conversation,
      options: { json },
      run: ({ positionals }) =>
        result(work.agreement(positionals.conversationId)),
    }),
    "contract update": cliCommand({
      summary:
        "Revise responsibility/reporting with a revision check; does not start or resume work",
      positionals: conversation,
      options: {
        agreement: {
          type: "string",
          required: true,
          description: "Complete agreement JSON from contract show",
        },
        revision: {
          type: "integer",
          required: true,
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          description: "Expected current contract revision",
        },
        author,
        reason,
        json,
      },
      async run({ positionals, options }, ctx) {
        const target = store.conversations.get(positionals.conversationId);
        const caller = ctx.threadId
          ? store.conversations.ownerOfThread(ctx.threadId)
          : null;
        if (caller && caller.botId !== target.botId)
          throw new PluginCliError(
            "Owned caller cannot revise another bot's contract.",
            { code: "wrong_owner" },
          );
        const agreement = agreementSchema.parse(JSON.parse(options.agreement));
        await routing.resolve(agreement.reportTo);
        ctx.signal?.throwIfAborted();
        const updated = work.updateAgreement({
          conversationId: target.id,
          expectedRevision: options.revision,
          agreement,
          author: options.author,
          reason: options.reason,
        });
        changed();
        return result(updated);
      },
    }),
    msg: cliCommand({
      summary:
        "Send an explicit message to current main; queue-if-active may wake an idle recipient, never resume canceled work",
      positionals: message,
      options: {
        bot: {
          type: "string",
          description: "Explicit bot required for an unowned caller",
        },
        json,
      },
      async run({ positionals, options }, ctx) {
        return result(
          await routing.message(
            positionals.message,
            options.bot,
            ctx.threadId,
            ctx.signal,
          ),
        );
      },
    }),
    report: cliCommand({
      summary:
        "Send to the owned caller's contract target; may wake idle, does not resume canceled work or prove reading",
      positionals: message,
      options: { json },
      async run({ positionals }, ctx) {
        return result(
          await routing.report(positionals.message, ctx.threadId, ctx.signal),
        );
      },
    }),
    reply: cliCommand({
      summary:
        "Reply to the native agent sender of one message sequence; never infer sender from prose",
      positionals: message,
      options: {
        seq: {
          type: "integer",
          required: true,
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
          description:
            "Native incoming message sequence from this caller's history",
        },
        json,
      },
      async run({ positionals, options }, ctx) {
        return result(
          await routing.reply(
            positionals.message,
            options.seq,
            ctx.threadId,
            ctx.signal,
          ),
        );
      },
    }),
  };
}
