import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { type JudgeApi, publicError } from "./api.ts";
import { assertJson, LIMITS, ValidationError } from "./json.ts";
import { questionCommands } from "./sets-cli.ts";
import { templateCommands } from "./templates-cli.ts";
import { triggerCommands } from "./triggers-cli.ts";
import { evaluationCommands } from "./evaluation-cli.ts";

const json = {
  type: "boolean",
  description:
    "Emit JSON; unavailable verdicts still exit 0, operational errors exit 1",
} as const;
const id = {
  name: "id",
  description: "Judge model ID",
  required: true,
} as const;
const limit = {
  type: "integer",
  min: 1,
  max: 100,
  default: 20,
  short: "n",
  description: "Page size (1–100, default 20)",
} as const;

function parseJson(value: string): unknown {
  if (Buffer.byteLength(value, "utf8") > LIMITS.requestBytes)
    throw new ValidationError();
  try {
    const parsed: unknown = JSON.parse(value);
    assertJson(parsed);
    return parsed;
  } catch {
    throw new ValidationError();
  }
}

async function output(
  asJson: boolean,
  operation: () => unknown | Promise<unknown>,
): Promise<PluginCliResult> {
  try {
    const result = await operation();
    return {
      exitCode: 0,
      stdout: JSON.stringify(result, null, asJson ? undefined : 2),
    };
  } catch (error) {
    throw new PluginCliError(publicError(error), {
      code: publicError(error),
      hint: "Check command --help and Judge settings. A storage error means no logged verdict was returned.",
    });
  }
}

export function registerCli(bb: BbPluginApi, api: JudgeApi): void {
  bb.cli.register(
    defineCli({
      name: "judge",
      summary: "Explicit typed judgments, model setup and bounded run history",
      description:
        "Secrets belong in Settings → Installed plugins → Judge. Saving or checking readiness never calls a provider. Explicit asks and models check --probe can incur charges.",
      commands: {
        ...questionCommands(bb, api.sets),
        ...templateCommands(api.templates),
        ...evaluationCommands(api),
        ...triggerCommands(api),
        ask: cliCommand({
          summary: "Run a saved set or judge explicit JSON state",
          description:
            "Supply a saved set ID, or --state with --noul/--questions. --not-private declares only ad hoc state public and cannot apply to saved sources. Unavailable is a typed logged verdict, not a CLI failure.",
          positionals: [
            {
              name: "set",
              description: "Saved question-set ID",
              required: false,
            },
          ],
          options: {
            json,
            state: {
              type: "string",
              description:
                "JSON state (64 KiB per input; 256 KiB complete request)",
            },
            noul: {
              type: "string",
              description: "One noul question, returned as main",
            },
            questions: {
              type: "string",
              description: "JSON map of 1–64 typed noul/choice/score questions",
            },
            model: {
              type: "string",
              description:
                "Model override; otherwise step, set, then global default",
            },
            thread: {
              type: "string",
              description: "Explicit thread context; otherwise calling thread",
            },
            "not-private": {
              type: "boolean",
              description: "Declare this explicit ad hoc state public",
            },
          },
          run: (input, ctx) =>
            output(input.options.json, () => {
              const threadId = input.options.thread ?? ctx.threadId;
              if (input.positionals.set !== undefined) {
                if (
                  input.options.state !== undefined ||
                  input.options.noul !== undefined ||
                  input.options.questions !== undefined ||
                  input.options["not-private"]
                )
                  throw new ValidationError("saved_set_arguments");
                return api.runner.run(
                  {
                    id: input.positionals.set,
                    threadId,
                    ...(input.options.thread === undefined
                      ? { projectId: ctx.projectId }
                      : {}),
                    model: input.options.model,
                  },
                  ctx.signal,
                );
              }
              if (
                input.options.state === undefined ||
                (input.options.noul === undefined) ===
                  (input.options.questions === undefined)
              )
                throw new ValidationError("ad_hoc_arguments");
              return api.asks.ask(
                {
                  state: parseJson(input.options.state),
                  questions:
                    input.options.noul !== undefined
                      ? {
                          main: {
                            type: "noul",
                            instructions: input.options.noul,
                          },
                        }
                      : parseJson(input.options.questions!),
                  model: input.options.model,
                  notPrivate: input.options["not-private"],
                  threadId,
                  projectId:
                    input.options.thread === undefined ||
                    input.options.thread === ctx.threadId
                      ? ctx.projectId
                      : undefined,
                },
                ctx.signal,
              );
            }),
        }),
        "models list": cliCommand({
          summary: "List model configurations and defaults without credentials",
          options: {
            json,
            limit,
            after: {
              type: "string",
              description: "Continue after the previous page's next model ID",
            },
          },
          run: (input) =>
            output(input.options.json, () =>
              api.list({
                limit: input.options.limit,
                after: input.options.after,
              }),
            ),
        }),
        "models add": cliCommand({
          summary: "Add/update a model; never invokes inference",
          positionals: [id],
          options: {
            json,
            connection: {
              type: "enum",
              values: ["typesafe", "cloudflare", "custom"],
              required: true,
              description: "BB-owned credential connection",
            },
            model: {
              type: "string",
              required: true,
              description: "Provider selector; Cloudflare: clef or clef-flash",
            },
            "allow-private": {
              type: "boolean",
              description:
                "Explicitly permit private state on this model (default false)",
            },
            timeout: {
              type: "duration",
              defaultUnit: "ms",
              min: 1,
              max: 30_000,
              default: 2_000,
              description: "Request timeout, 1ms–30s (default 2s)",
            },
          },
          run: (input) =>
            output(input.options.json, () =>
              api.models.save({
                id: input.positionals.id,
                connection: input.options.connection,
                model: input.options.model,
                allowPrivate: input.options["allow-private"],
                timeoutMs: input.options.timeout,
              }),
            ),
        }),
        "models default": cliCommand({
          summary: "Choose an explicit global or private default",
          positionals: [id],
          options: {
            json,
            private: {
              type: "boolean",
              description:
                "Set the private fallback; model must allow private input",
            },
          },
          run: (input) =>
            output(input.options.json, () => {
              api.models.setDefault(
                input.positionals.id,
                input.options.private,
              );
              return api.models.defaults();
            }),
        }),
        "models check": cliCommand({
          summary:
            "Read sanitized readiness; --probe explicitly tests synthetic public state",
          positionals: [id],
          options: {
            json,
            probe: {
              type: "boolean",
              description:
                "Make one tiny synthetic public inference request (may incur charges)",
            },
          },
          run: (input, ctx) =>
            output(input.options.json, () =>
              api.check(input.positionals.id, input.options.probe, ctx.signal),
            ),
        }),
        log: cliCommand({
          summary: "Read bounded run summaries without answers or input state",
          options: {
            json,
            limit,
            set: { type: "string", description: "Filter by saved set ID" },
            thread: { type: "string", description: "Filter by thread ID" },
            before: {
              type: "string",
              description:
                "JSON next cursor from previous page (startedAt and runId)",
            },
          },
          run: (input) =>
            output(input.options.json, () =>
              api.log({
                limit: input.options.limit,
                setId: input.options.set,
                threadId: input.options.thread,
                before:
                  input.options.before === undefined
                    ? undefined
                    : parseJson(input.options.before),
              }),
            ),
        }),
      },
    }),
  );
}
