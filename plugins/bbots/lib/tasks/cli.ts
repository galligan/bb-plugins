import { cliCommand } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { TaskSource } from "./source.ts";
import { markdownCommands } from "./markdown-cli.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const options = {
  revision: {
    type: "integer",
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    description: "Expected source revision; 0 when unconfigured",
  },
  author: {
    type: "string",
    required: true,
    description: "Truthful person or agent making this edit",
  },
  reason: {
    type: "string",
    required: true,
    description: "User instruction motivating this source choice",
  },
  json: { type: "boolean", description: "Emit machine-readable JSON" },
} as const;
const board = {
  type: "string",
  required: true,
  description: "Stable Tasks tracker ID, not a BB project ID or board name",
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function taskCommands(source: TaskSource, store: SetupStore) {
  function owner(botId: string, threadId?: string) {
    const caller = threadId
      ? store.conversations.ownerOfThread(threadId)
      : null;
    if (caller && caller.botId !== botId)
      throw new Error(
        "Owned caller cannot change another bot's task authority.",
      );
  }
  return {
    ...markdownCommands(source, store),
    "tasks show": cliCommand({
      summary:
        "Read the stable task authority and live availability; no fallback or provider turn",
      positionals: bot,
      options: { json: options.json },
      run: async ({ positionals }, ctx) =>
        result(await source.show(positionals.botId, ctx.signal)),
    }),
    "tasks select": cliCommand({
      summary:
        "Select an existing Tasks board once; no project binding or migration",
      positionals: bot,
      options: { ...options, board },
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.select(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              boardId: options.board,
              author: options.author,
              reason: options.reason,
            },
            ctx.signal,
          ),
        );
      },
    }),
    "tasks create": cliCommand({
      summary:
        "Journal one explicit dedicated Tasks board creation; uncertain outcomes require recovery by ID",
      positionals: bot,
      options: {
        ...options,
        prefix: {
          type: "string",
          required: true,
          description: "Unused uppercase Tasks prefix, at most 10 characters",
        },
      },
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.create(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              prefix: options.prefix,
              author: options.author,
              reason: options.reason,
            },
            ctx.signal,
          ),
        );
      },
    }),
    "tasks recover": cliCommand({
      summary:
        "Confirm the stable board ID for an interrupted creation; never creates a second board",
      positionals: bot,
      options: { ...options, board },
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.recover(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              boardId: options.board,
              author: options.author,
              reason: options.reason,
            },
            ctx.signal,
          ),
        );
      },
    }),
  };
}
