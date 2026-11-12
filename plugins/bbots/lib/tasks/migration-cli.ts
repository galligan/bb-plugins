import { cliCommand } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { createMigration } from "./migration.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function migrationCommands(
  migration: ReturnType<typeof createMigration>,
  store: SetupStore,
) {
  function owner(botId: string, threadId?: string) {
    const caller = threadId
      ? store.conversations.ownerOfThread(threadId)
      : null;
    if (caller && caller.botId !== botId)
      throw new Error(
        "Owned caller cannot read or migrate another bot's task authority.",
      );
  }
  return {
    "tasks migration-show": cliCommand({
      summary:
        "Read a retained migration receipt, original source and attested mapping",
      positionals: [
        ...bot,
        {
          name: "requestId",
          description: "Retained migration UUID",
          required: true,
        },
      ],
      options: { json },
      run({ positionals }, ctx) {
        owner(positionals.botId, ctx.threadId);
        return result(migration.read(positionals.botId, positionals.requestId));
      },
    }),
    "tasks migration-confirm": cliCommand({
      summary:
        "Confirm a user-directed, already prepared source migration; copies or deletes no tasks",
      positionals: bot,
      options: {
        json,
        revision: {
          type: "integer",
          required: true,
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          description: "Expected established source revision",
        },
        "request-id": {
          type: "string",
          required: true,
          description:
            "Retain a UUID before confirmation; same request replays its receipt",
        },
        board: {
          type: "string",
          description: "Existing stable destination Tasks tracker ID",
        },
        "markdown-hash": {
          type: "string",
          description:
            "SHA-256 of an already prepared tasks.md in the original home; alternative to --board",
        },
        mapping: {
          type: "string",
          required: true,
          description:
            "JSON array of 1–20 {from,to} source references, including a full mapping artifact if needed; each reference at most 512 characters",
        },
        evidence: {
          type: "string",
          required: true,
          description:
            "Attestation/reference to the completed content and mapping inspection, at most 2,048 characters; not automatically verified",
        },
        author: {
          type: "string",
          required: true,
          description: "Truthful person or agent confirming this migration",
        },
        reason: {
          type: "string",
          required: true,
          description:
            "Explicit user instruction authorizing the authority change",
        },
      },
      async run({ positionals, options }, ctx) {
        owner(positionals.botId, ctx.threadId);
        if (Boolean(options.board) === Boolean(options["markdown-hash"]))
          throw new Error(
            "Choose exactly one destination: --board or --markdown-hash.",
          );
        let mapping: unknown;
        try {
          mapping = JSON.parse(options.mapping);
        } catch {
          throw new Error(
            "Mapping must be JSON containing {from,to} references.",
          );
        }
        return result(
          await migration.confirm(
            {
              botId: positionals.botId,
              expectedRevision: options.revision,
              requestId: options["request-id"],
              author: options.author,
              reason: options.reason,
              target: options.board
                ? { kind: "tasks", boardId: options.board }
                : { kind: "markdown", expectedHash: options["markdown-hash"]! },
              mapping: mapping as { from: string; to: string }[],
              evidence: options.evidence,
            },
            ctx.signal,
          ),
        );
      },
    }),
  };
}
