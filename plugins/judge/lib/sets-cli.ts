import {
  cliCommand,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { publicError } from "./api.ts";
import { readCallerYaml } from "./caller-file.ts";
import type { SetService } from "./sets.ts";
import { setListSchema } from "./sets-contract.ts";

const json = {
  type: "boolean",
  description: "Emit JSON results or structured errors",
} as const;
const id = {
  name: "id",
  required: true,
  description: "Global question set ID",
} as const;

export function questionCommands(bb: BbPluginApi, sets: SetService) {
  async function output(
    operation: () => unknown | Promise<unknown>,
    rawYaml = false,
  ) {
    try {
      const value = await operation();
      return {
        exitCode: 0,
        stdout: rawYaml ? String(value) : JSON.stringify(value, null, 2),
      };
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      throw new PluginCliError(publicError(error), {
        code: publicError(error),
        hint: "Check --help. Files require a calling thread or --machine with an absolute host path; definitions must be bounded valid YAML.",
      });
    }
  }
  const save = cliCommand({
    summary:
      "Save/import global YAML from the caller host; disables dependent triggers",
    aliases: ["questions save"],
    options: {
      json,
      file: {
        type: "string",
        required: true,
        description: "Caller-host YAML file, at most256KiB",
      },
      machine: {
        type: "string",
        description: "Connected host ID/name; requires absolute file path",
      },
    },
    run: (input, ctx) =>
      output(async () =>
        sets.save(
          await readCallerYaml(
            bb,
            input.options.file,
            input.options.machine,
            ctx,
          ),
        ),
      ),
  });
  return {
    "questions list": cliCommand({
      summary: "List global sets with project applicability (no execution)",
      options: {
        json,
        limit: {
          type: "integer",
          min: 1,
          max: 100,
          default: 20,
          short: "n",
          description: "Page size1–100",
        },
        after: { type: "string", description: "Previous page next ID" },
        project: {
          type: "string",
          description:
            "Project applicability context; defaults to caller project",
        },
      },
      run: (input, ctx) =>
        output(() =>
          sets.list(
            setListSchema.parse({
              limit: input.options.limit,
              after: input.options.after,
              projectId: input.options.project ?? ctx.projectId,
            }),
          ),
        ),
    }),
    "questions show": cliCommand({
      summary: "Show normalized definition, hash and YAML",
      positionals: [id],
      options: { json },
      run: (input) => output(() => sets.get(input.positionals.id)),
    }),
    "questions import": save,
    "questions export": cliCommand({
      summary: "Print normalized YAML to stdout; --json wraps it in JSON",
      positionals: [id],
      options: { json },
      run: (input) =>
        output(() => {
          const record = sets.get(input.positionals.id);
          if (!record)
            throw new PluginCliError("missing_set", { code: "missing_set" });
          return input.options.json ? { yaml: record.yaml } : record.yaml;
        }, !input.options.json),
    }),
    "questions remove": cliCommand({
      summary: "Remove a definition and disable dependent triggers",
      positionals: [id],
      options: { json },
      run: (input) => output(() => sets.remove(input.positionals.id)),
    }),
    "projects set": cliCommand({
      summary:
        "Set project applicability switch; conservatively disables all triggers",
      positionals: [{ name: "id", required: true, description: "Project ID" }],
      options: {
        json,
        enabled: {
          type: "enum",
          values: ["true", "false"],
          required: true,
          description:
            "Explicit switch; default for unconfigured projects is on",
        },
      },
      run: (input) =>
        output(() =>
          sets.project(input.positionals.id, input.options.enabled === "true"),
        ),
    }),
  };
}
