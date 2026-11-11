import { cliCommand } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { TaskSource } from "./source.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const edit = {
  revision: {
    type: "integer",
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    description: "Expected source revision, 0 for initial choice",
  },
  author: {
    type: "string",
    required: true,
    description: "Truthful person or agent choosing this authority",
  },
  reason: {
    type: "string",
    required: true,
    description: "Explicit source instruction or recovery reason",
  },
  json,
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function markdownCommands(source: TaskSource, store: SetupStore) {
  function owner(botId: string, threadId?: string) {
    const caller = threadId
      ? store.conversations.ownerOfThread(threadId)
      : null;
    if (caller && caller.botId !== botId)
      throw new Error(
        "Owned caller cannot edit another bot's task authority or file.",
      );
  }
  return {
    "tasks markdown-init": cliCommand({
      summary:
        "Choose tasks.md once only if Tasks is absent; initialize on the recorded home host",
      positionals: bot,
      options: edit,
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.markdownInitialize(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              author: options.author,
              reason: options.reason,
            },
            ctx.signal,
          ),
        );
      },
    }),
    "tasks markdown-resume": cliCommand({
      summary:
        "Explicitly finish the same interrupted tasks.md initialization; never overwrite an occupied file",
      positionals: bot,
      options: edit,
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.markdownResume(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              author: options.author,
              reason: options.reason,
            },
            ctx.signal,
          ),
        );
      },
    }),
    "tasks read": cliCommand({
      summary:
        "Read authoritative Markdown and content hash from the original home host; no task parsing",
      positionals: bot,
      options: { json },
      run: async ({ positionals }, ctx) =>
        result(await source.markdownRead(positionals.botId, ctx.signal)),
    }),
    "tasks write": cliCommand({
      summary:
        "Replace complete tasks.md on its home host under an exclusive lock and expected content hash",
      positionals: bot,
      options: {
        hash: {
          type: "string",
          required: true,
          description: "SHA-256 from the latest tasks read; stale edits fail",
        },
        markdown: {
          type: "string",
          required: true,
          description:
            "Complete authoritative UTF-8 Markdown, at most 65,536 bytes",
        },
        json,
      },
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(
          await source.markdownWrite(
            positionals.botId,
            options.hash,
            options.markdown,
            ctx.signal,
          ),
        );
      },
    }),
  };
}
