import { cliCommand, PluginCliError } from "@get-bb/plugin-sdk";
import type { JudgeApi } from "./api.ts";
import { publicError } from "./api.ts";
import { assertJson, ValidationError } from "./json.ts";
const json = {
  type: "boolean",
  description: "Emit JSON results or structured errors",
} as const;
const id = {
  name: "id",
  required: true,
  description: "Judge binding ID",
} as const;
function decode(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    assertJson(parsed);
    return parsed;
  } catch {
    throw new ValidationError("invalid_json");
  }
}
export function triggerCommands(api: JudgeApi) {
  const output = async (operation: () => unknown | Promise<unknown>) => {
    try {
      return {
        exitCode: 0,
        stdout: JSON.stringify(await operation(), null, 2),
      };
    } catch (error) {
      throw new PluginCliError(publicError(error), {
        code: publicError(error),
        hint: "Check --help and saved outcome IDs. Saved/edited bindings are disabled; enabling is explicit and can incur provider charges on matching events. Calibration/private policy remain separate.",
      });
    }
  };
  return {
    "triggers list": cliCommand({
      summary: "List bounded trigger configurations without inference",
      options: {
        json,
        limit: {
          type: "integer",
          min: 1,
          max: 20,
          default: 20,
          description: "Full configurations per page (1–20)",
        },
        after: {
          type: "string",
          description: "Next binding ID from the previous page",
        },
      },
      run: (input) =>
        output(() =>
          api.triggers.list({
            limit: input.options.limit,
            after: input.options.after,
          }),
        ),
    }),
    "triggers show": cliCommand({
      summary: "Read one binding and its enabled state",
      positionals: [id],
      options: { json },
      run: (input) => output(() => api.triggers.get(input.positionals.id)),
    }),
    "triggers add": cliCommand({
      summary:
        "Save/edit a disabled event binding; record is implicit, badges are optional",
      aliases: ["triggers save"],
      description:
        "Only thread.idle and turn.failed are supported. Every save disables the binding; it cannot grant private input permission or calibration. No arbitrary actions or messages.",
      positionals: [id],
      options: {
        json,
        set: {
          type: "string",
          required: true,
          description: "Existing saved question set",
        },
        event: {
          type: "enum",
          values: ["thread.idle", "turn.failed"],
          required: true,
          description: "thread.idle or turn.failed",
        },
        projects: {
          type: "string",
          default: "all",
          description: "all, or a JSON array of project IDs",
        },
        badges: {
          type: "string",
          default: "{}",
          description: "JSON map from final outcome IDs to short text labels",
        },
      },
      run: (input) =>
        output(() =>
          api.triggers.save({
            id: input.positionals.id,
            setId: input.options.set,
            event: input.options.event,
            projects:
              input.options.projects === "all"
                ? "all"
                : decode(input.options.projects),
            badges: decode(input.options.badges),
          }),
        ),
    }),
    "triggers enable": cliCommand({
      summary: "Explicitly enable a binding; matching events may incur charges",
      description:
        "Only complete, calibrated and current runs can publish configured badges. Record-only or uncalibrated attempts still enter bounded history. This is a workflow control, not proof that the caller is human.",
      positionals: [id],
      options: { json },
      run: (input) =>
        output(() => api.triggers.enable(input.positionals.id, true)),
    }),
    "triggers disable": cliCommand({
      summary:
        "Disable a binding, abort its active work and clear stale badges",
      positionals: [id],
      options: { json },
      run: (input) =>
        output(() => api.triggers.enable(input.positionals.id, false)),
    }),
    "triggers remove": cliCommand({
      summary:
        "Remove a binding and clear its derived badges; retain run history",
      positionals: [id],
      options: { json },
      run: (input) =>
        output(() => {
          api.triggers.remove(input.positionals.id);
          return { removed: true };
        }),
    }),
    "triggers log": cliCommand({
      summary:
        "Read bounded trigger admission and publication diagnostics without answers",
      options: {
        json,
        trigger: { type: "string", description: "Filter by binding ID" },
        thread: { type: "string", description: "Filter by thread ID" },
        limit: {
          type: "integer",
          min: 1,
          max: 100,
          default: 20,
          description: "Diagnostics per page (1–100)",
        },
        before: {
          type: "string",
          description: "JSON continuation cursor from the previous page",
        },
      },
      run: (input) =>
        output(() =>
          api.repository.triggerAttempts.list({
            triggerId: input.options.trigger,
            threadId: input.options.thread,
            limit: input.options.limit,
            before:
              input.options.before === undefined
                ? undefined
                : decode(input.options.before),
          }),
        ),
    }),
  };
}
