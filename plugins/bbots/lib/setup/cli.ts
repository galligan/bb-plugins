import {
  cliCommand,
  defineCli,
  PluginCliError,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { createSchema, type Setup } from "./contracts.ts";
import { newRequestId, type SetupStore } from "./storage.ts";
import type { createSetupService } from "./service.ts";
import { developmentStatus, formatStatus } from "../status.ts";
import { soulCommands } from "../soul/cli.ts";
import type { SoulStore } from "../soul/store.ts";
import type { workCommands } from "../work/cli.ts";
import type { WorkStore } from "../work/storage.ts";

const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const bot = [
  {
    name: "botId",
    description: "Stable bot ID from create or list",
    required: true,
  },
] as const;
function result(value: unknown, json: boolean | undefined): PluginCliResult {
  const error = (value as { setup?: Setup }).setup?.error;
  return {
    exitCode: error ? 1 : 0,
    stdout: json
      ? JSON.stringify(value) + "\n"
      : JSON.stringify(value, null, 2) + "\n",
  };
}
export function botCli(
  store: SetupStore,
  service: ReturnType<typeof createSetupService>,
  soul: SoulStore,
  workers: ReturnType<typeof workCommands>,
  work: WorkStore,
) {
  return defineCli({
    name: "bot",
    summary: "Create and inspect persistent Bots",
    commands: {
      ...soulCommands(soul, store, work),
      ...workers,
      status: cliCommand({
        summary: "Show development status and support limits",
        options: { json },
        run: ({ options }) => ({
          exitCode: 0,
          stdout: options.json
            ? JSON.stringify(developmentStatus()) + "\n"
            : formatStatus(developmentStatus()),
        }),
      }),
      list: cliCommand({
        summary: "List up to 100 bots",
        options: { json },
        run: ({ options }) => result(store.list(), options.json),
      }),
      show: cliCommand({
        summary: "Show bot identity, home, main and recoverable setup state",
        positionals: bot,
        options: { json },
        run: ({ positionals, options }) =>
          result(store.view(positionals.botId), options.json),
      }),
      create: cliCommand({
        summary:
          "Create Bob (or a named bot), persistent home and pinned main; starts one setup acknowledgement",
        options: {
          name: {
            type: "string",
            description: "Bot display name (default Bob)",
          },
          machine: {
            type: "string",
            required: true,
            description: "Connected BB machine ID",
          },
          "home-base": {
            type: "string",
            description:
              "Absolute directory outside repositories and BB data; default ~/.bb-bots on that machine",
          },
          "request-id": {
            type: "string",
            description:
              "UUID idempotency key; reuse with identical options after uncertain delivery",
          },
          "association-mode": {
            type: "enum",
            values: ["none", "all", "selected"],
            default: "none",
            description:
              "Project responsibility scope; does not relocate the main home",
          },
          project: {
            type: "string",
            repeatable: true,
            description:
              "Associated project ID; repeat with --association-mode selected",
          },
          provider: {
            type: "string",
            description: "Native provider ID (otherwise BB default)",
          },
          model: {
            type: "string",
            description: "Native model ID (otherwise BB default)",
          },
          reasoning: {
            type: "string",
            description:
              "Native provider/model reasoning level (otherwise BB default)",
          },
          permissions: {
            type: "enum",
            values: ["accept-edits", "auto", "full"],
            description:
              "Native permission mode (otherwise BB default); applies to the new main only",
          },
          json,
        },
        async run({ options }, ctx) {
          if (
            options.project?.length &&
            options["association-mode"] !== "selected"
          )
            throw new PluginCliError(
              "--project requires --association-mode selected",
              { code: "invalid_setup" },
            );
          const input = createSchema.safeParse({
            associations:
              options["association-mode"] === "selected"
                ? { mode: "selected", projectIds: options.project ?? [] }
                : { mode: options["association-mode"] },
            requestId: options["request-id"] ?? newRequestId(),
            name: options.name,
            hostId: options.machine,
            homeBase: options["home-base"],
            providerId: options.provider,
            model: options.model,
            reasoningLevel: options.reasoning,
            permissionMode: options.permissions,
          });
          if (!input.success)
            throw new PluginCliError(
              input.error.issues.map((i) => i.message).join("; "),
              { code: "invalid_setup" },
            );
          return result(
            await service.create(input.data, ctx.signal),
            options.json,
          );
        },
      }),
      resume: cliCommand({
        summary:
          "Reconcile partial setup without respawning an uncertain main or resending its prompt",
        positionals: bot,
        options: { json },
        async run({ positionals, options }, ctx) {
          return result(
            await service.resume(positionals.botId, ctx.signal),
            options.json,
          );
        },
      }),
      rename: cliCommand({
        summary:
          "Rename a bot and its managed main title without moving its home or changing pin preference",
        positionals: bot,
        options: {
          name: {
            type: "string",
            required: true,
            description: "New display name",
          },
          revision: {
            type: "integer",
            required: true,
            min: 1,
            max: Number.MAX_SAFE_INTEGER,
            description: "Expected profile revision from show",
          },
          json,
        },
        async run({ positionals, options }, ctx) {
          return result(
            await service.rename(
              {
                botId: positionals.botId,
                name: options.name,
                expectedRevision: options.revision,
              },
              ctx.signal,
            ),
            options.json,
          );
        },
      }),
    },
  });
}
