import { cliCommand, PluginCliError } from "@get-bb/plugin-sdk";
import type { SoulStore } from "./store.ts";
import type { SetupStore } from "../setup/storage.ts";
import { defaultsSchema } from "./contracts.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const revision = {
  type: "integer",
  required: true,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  description: "Expected document revision from show (0 if absent)",
} as const;
const author = {
  type: "string",
  required: true,
  description: "Truthful identity of the person or agent making this edit",
} as const;
const reason = {
  type: "string",
  required: true,
  description: "User instruction or approval motivating this deliberate edit",
} as const;
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function soulCommands(soul: SoulStore, store: SetupStore) {
  return {
    brief: cliCommand({
      summary:
        "Pull bounded current identity, revision/defaults and feature availability; starts no turn",
      positionals: bot,
      options: { json },
      run: ({ positionals }) => {
        const view = store.view(positionals.botId);
        const { current, ...state } = soul.show(view.bot.id);
        return result({
          ...view,
          soul: { ...state, currentRevision: current?.revision ?? null },
          execution: soul.defaults(view.bot.id),
          unavailable: ["tasks", "memory", "commitments", "worker contracts"],
        });
      },
    }),
    "soul show": cliCommand({
      summary:
        "Read revisioned SOUL.md and supplied versus unknown applied state",
      positionals: bot,
      options: { json },
      run: ({ positionals }) => result(soul.show(positionals.botId)),
    }),
    "soul update": cliCommand({
      summary:
        "Deliberately revise SOUL.md; does not refresh a live session or start a turn",
      positionals: bot,
      options: {
        revision,
        author,
        reason,
        markdown: {
          type: "string",
          required: true,
          description:
            "Complete Markdown, at most 16,000 characters; no host file is read",
        },
        json,
      },
      run: ({ positionals, options }) =>
        result(
          soul.update({
            botId: positionals.botId,
            expectedRevision: options.revision,
            markdown: options.markdown,
            author: options.author,
            reason: options.reason,
          }),
        ),
    }),
    "models show": cliCommand({
      summary:
        "Read future conversation defaults; worker null inherits main, automatic fallback disabled",
      positionals: bot,
      options: { json },
      run: ({ positionals }) => result(soul.defaults(positionals.botId)),
    }),
    "models update": cliCommand({
      summary:
        "Save future native execution choices; existing main is unchanged, availability checked at creation",
      positionals: bot,
      options: {
        revision,
        author,
        reason,
        defaults: {
          type: "string",
          required: true,
          description:
            'Complete JSON: {"main":{},"worker":null,"fallback":null}; native permission modes accept-edits|auto|full',
        },
        json,
      },
      run: ({ positionals, options }) => {
        let value;
        try {
          value = defaultsSchema.parse(JSON.parse(options.defaults));
        } catch {
          throw new PluginCliError(
            "Invalid defaults JSON. Use main, worker and fallback objects; fallback cannot change permissions.",
            { code: "invalid_defaults" },
          );
        }
        return result(
          soul.updateDefaults({
            botId: positionals.botId,
            expectedRevision: options.revision,
            defaults: value,
            author: options.author,
            reason: options.reason,
          }),
        );
      },
    }),
  };
}
