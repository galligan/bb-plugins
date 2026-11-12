import { cliCommand, type PluginCliContext } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { createSchema } from "./contracts.ts";
import { markdownExport, type Checkpoints } from "./store.ts";

const bot = [
  { name: "botId", required: true, description: "Stable bot ID" },
] as const;
const entry = [
  ...bot,
  { name: "checkpointId", required: true, description: "Stable chk_ ID" },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}

export function checkpointCommands(
  checkpoints: Checkpoints,
  store: SetupStore,
  lifecycle: AbortSignal,
) {
  function caller(botId: string, ctx: PluginCliContext) {
    lifecycle.throwIfAborted();
    ctx.signal?.throwIfAborted();
    const owner = ctx.threadId
      ? store.conversations.ownerOfThread(ctx.threadId)
      : null;
    if (owner && owner.botId !== botId)
      throw new Error("Owned caller cannot read or checkpoint another bot.");
  }
  return {
    "checkpoint create": cliCommand({
      summary:
        "Save an immutable profile/SOUL/knowledge selection; starts no turn or restore",
      positionals: bot,
      options: {
        json,
        name: {
          type: "string",
          required: true,
          description: "Human-readable checkpoint name",
        },
        "request-id": {
          type: "string",
          required: true,
          description: "Retained UUID; replay recovers the original selection",
        },
        author: {
          type: "string",
          required: true,
          description: "Truthful person or agent creating the checkpoint",
        },
        reason: {
          type: "string",
          required: true,
          description: "Explicit instruction or evidence for the checkpoint",
        },
      },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          checkpoints.create(
            createSchema.parse({
              botId: positionals.botId,
              requestId: options["request-id"],
              name: options.name,
              author: options.author,
              reason: options.reason,
            }),
          ),
        );
      },
    }),
    "checkpoint list": cliCommand({
      summary:
        "List at most ten checkpoint headers without reading the knowledge corpus",
      positionals: bot,
      options: {
        json,
        after: {
          type: "string",
          description: "nextCursor from the previous list page",
        },
      },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(checkpoints.list(positionals.botId, options.after));
      },
    }),
    "checkpoint show": cliCommand({
      summary:
        "Read checkpoint identity, selected profile/defaults and document count",
      positionals: entry,
      options: { json },
      run({ positionals }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          checkpoints.show(positionals.botId, positionals.checkpointId),
        );
      },
    }),
    "checkpoint export": cliCommand({
      summary:
        "Export one historical document per JSON/Markdown page; current forgetting exclusions apply",
      positionals: entry,
      options: {
        after: {
          type: "string",
          description:
            "nextCursor from the preceding export page; continue until null",
        },
        format: {
          type: "enum",
          values: ["json", "markdown"],
          default: "json",
          description: "Portable output, not a full database backup or import",
        },
      },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        const page = checkpoints.page(
          positionals.botId,
          positionals.checkpointId,
          options.after,
        );
        return options.format === "markdown"
          ? { exitCode: 0, stdout: markdownExport(page) }
          : result(page);
      },
    }),
  };
}
