import { randomUUID } from "node:crypto";
import { cliCommand } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { Commitments } from "./service.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const record = [
  ...bot,
  {
    name: "commitmentId",
    description: "Stable cmt_ ID from add/list",
    required: true,
  },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const change = {
  author: {
    type: "string",
    required: true,
    description: "Truthful person or agent making this deliberate edit",
  },
  reason: {
    type: "string",
    required: true,
    description: "Instruction or evidence motivating this change",
  },
  json,
} as const;
const revision = {
  type: "integer",
  required: true,
  min: 1,
  max: Number.MAX_SAFE_INTEGER,
  description: "Expected commitment revision from show",
} as const;
const link = {
  task: {
    type: "string",
    description: "Stable task ID in the configured Tasks board, not a task key",
  },
  "markdown-reference": {
    type: "string",
    description:
      "Literal reference in the configured tasks.md; status must be read there",
  },
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function commitmentCommands(service: Commitments, store: SetupStore) {
  function caller(botId: string, threadId?: string) {
    const owner = threadId ? store.conversations.ownerOfThread(threadId) : null;
    if (owner && owner.botId !== botId)
      throw new Error(
        "Owned caller cannot read or change another bot's commitments.",
      );
    return owner;
  }
  return {
    "commitment add": cliCommand({
      summary:
        "Record an attributable obligation; linked status remains owned by the task source",
      positionals: bot,
      options: {
        ...change,
        ...link,
        what: {
          type: "string",
          required: true,
          description: "What is owed, at most 4,096 characters",
        },
        owner: {
          type: "string",
          description:
            "Logical conversation owner; default calling owner or selected bot's main",
        },
        evidence: {
          type: "string",
          repeatable: true,
          description:
            "Supporting source reference; up to 20, each at most 1,024 characters",
        },
        "request-id": {
          type: "string",
          description:
            "Retain a UUID before scripted creation; same options never duplicate the obligation",
        },
      },
      async run({ positionals, options }, ctx) {
        const owner = caller(positionals.botId, ctx.threadId);
        return result(
          await service.add(
            {
              botId: positionals.botId,
              requestId: options["request-id"] ?? randomUUID(),
              ownerConversationId:
                options.owner ??
                owner?.id ??
                store.view(positionals.botId).main.id,
              what: options.what,
              evidence: options.evidence ?? [],
              author: options.author,
              reason: options.reason,
              ...(options.task ? { taskId: options.task } : {}),
              ...(options["markdown-reference"]
                ? { markdownReference: options["markdown-reference"] }
                : {}),
            },
            ctx.signal,
          ),
        );
      },
    }),
    "commitment show": cliCommand({
      summary:
        "Read one obligation and point-in-time source status; unavailable linked status stays unknown",
      positionals: record,
      options: { json },
      async run({ positionals }, ctx) {
        caller(positionals.botId, ctx.threadId);
        return result(
          await service.show(
            positionals.botId,
            positionals.commitmentId,
            ctx.signal,
          ),
        );
      },
    }),
    "commitment list": cliCommand({
      summary:
        "Read at most 20 commitments and a stable next cursor; starts no background work",
      positionals: bot,
      options: {
        json,
        after: {
          type: "string",
          description: "nextCursor from the previous page",
        },
      },
      async run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx.threadId);
        return result(
          await service.list(positionals.botId, options.after, 20, ctx.signal),
        );
      },
    }),
    "commitment close": cliCommand({
      summary:
        "Close only an unlinked independent obligation; linked task status must change at its source",
      positionals: record,
      options: { ...change, revision },
      async run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx.threadId);
        return result(
          await service.close(
            positionals.botId,
            positionals.commitmentId,
            options.revision,
            options.author,
            options.reason,
            ctx.signal,
          ),
        );
      },
    }),
    "commitment relink": cliCommand({
      summary:
        "Explicitly reconcile a task reference with audit/revision; never copy or own linked status",
      positionals: record,
      options: { ...change, ...link, revision },
      async run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx.threadId);
        return result(
          await service.relink(
            positionals.botId,
            positionals.commitmentId,
            options.revision,
            options.task,
            options["markdown-reference"],
            options.author,
            options.reason,
            ctx.signal,
          ),
        );
      },
    }),
  };
}
