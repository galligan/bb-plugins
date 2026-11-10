import { cliCommand, PluginCliError } from "@get-bb/plugin-sdk";
import { publicError } from "./api.ts";
import type { TemplateService } from "./templates.ts";

export function templateCommands(templates: TemplateService) {
  const json = {
    type: "boolean",
    description: "Emit JSON results or structured errors",
  } as const;
  function output(operation: () => unknown) {
    try {
      return { exitCode: 0, stdout: JSON.stringify(operation(), null, 2) };
    } catch (error) {
      throw new PluginCliError(publicError(error), {
        code: publicError(error),
        hint: "Choose a listed template and a new --id. Copies do not run inference, activate triggers or inherit calibration.",
      });
    }
  }
  return {
    "templates list": cliCommand({
      summary: "List inert bundled examples and case counts; no execution",
      options: { json },
      run: () => output(() => templates.list()),
    }),
    "templates use": cliCommand({
      summary:
        "Copy a template into a new editable set; no activation or calibration",
      positionals: [
        {
          name: "template",
          required: true,
          description: "Bundled template ID",
        },
      ],
      options: {
        json,
        id: {
          type: "string",
          required: true,
          description: "New saved question-set ID (must not exist)",
        },
      },
      run: (input) =>
        output(() =>
          templates.use(input.positionals.template, input.options.id),
        ),
    }),
  };
}
