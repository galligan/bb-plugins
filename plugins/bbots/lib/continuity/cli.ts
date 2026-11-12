import { cliCommand, type PluginCliContext } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { Continuity } from "./store.ts";
import { prepareSchema } from "./contracts.ts";

const bot = [
  { name: "botId", required: true, description: "Stable bot ID" },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const conversation = {
  type: "string",
  required: true,
  description: "Same-bot logical main/worker conversation ID",
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function continuityCommands(
  continuity: Continuity,
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
      throw new Error(
        "Owned caller cannot inspect or prepare another bot's continuity.",
      );
  }
  return {
    "continuity prepare": cliCommand({
      summary:
        "Save checkpoint and bounded continuation references; no compact/clear/send/pickup or cutover",
      positionals: bot,
      options: {
        json,
        conversation,
        "request-id": {
          type: "string",
          required: true,
          description:
            "Retained preparation UUID; identical replay does not recapture or execute work",
        },
        author: {
          type: "string",
          required: true,
          description: "Truthful person/agent preparing continuation",
        },
        reason: {
          type: "string",
          required: true,
          description:
            "Instruction or authorized-turn evidence for preparation",
        },
      },
      async run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          await continuity.prepare(
            prepareSchema.parse({
              botId: positionals.botId,
              conversationId: options.conversation,
              requestId: options["request-id"],
              author: options.author,
              reason: options.reason,
            }),
            ctx.signal,
          ),
        );
      },
    }),
    "continuity show": cliCommand({
      summary:
        "Read filtered preparation references and current obligation/task state; observations remain historical",
      positionals: [
        ...bot,
        {
          name: "preparationId",
          required: true,
          description: "Stable cnt_ preparation ID",
        },
      ],
      options: { json },
      async run({ positionals }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          await continuity.show(
            positionals.botId,
            positionals.preparationId,
            ctx.signal,
          ),
        );
      },
    }),
    "continuity readiness": cliCommand({
      summary:
        "Observe bounded native usage/events/queue; grants no dispatch authority and starts no transition",
      positionals: bot,
      options: { json, conversation },
      async run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          await continuity.readiness(
            positionals.botId,
            options.conversation,
            ctx.signal,
          ),
        );
      },
    }),
  };
}
