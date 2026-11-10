import { cliCommand, PluginCliError } from "@get-bb/plugin-sdk";
import type { JudgeApi } from "./api.ts";
import { publicError } from "./api.ts";

export function evaluationCommands(api: JudgeApi) {
  const json = {
    type: "boolean",
    description: "Emit JSON reports or structured errors",
  } as const;
  const id = {
    name: "id",
    required: true,
    description: "Saved question-set ID",
  } as const;
  async function output(operation: () => unknown | Promise<unknown>) {
    try {
      return {
        exitCode: 0,
        stdout: JSON.stringify(await operation(), null, 2),
      };
    } catch (error) {
      throw new PluginCliError(publicError(error), {
        code: publicError(error),
        hint: "Check --help, authored cases and model privacy policy. Acceptance requires an exact complete current report; evaluation never accepts automatically.",
      });
    }
  }
  return {
    test: cliCommand({
      summary:
        "Explicitly evaluate authored cases; live model requests may incur charges",
      description:
        "Cases bypass live sources but remain sensitive. At most 100 cases, two variants and one active evaluation; execution budget 30 seconds. Reports show incorrect vs unavailable and disagreements without choosing a winner. No automatic calibration acceptance.",
      positionals: [id],
      options: {
        json,
        model: {
          type: "string",
          description:
            "Primary Judge model override; otherwise step/set/global selection",
        },
        compare: {
          type: "string",
          description:
            "Optional second Judge model override (not an automatic winner)",
        },
      },
      run: (input, ctx) =>
        output(() =>
          api.evaluations.test(
            {
              id: input.positionals.id,
              model: input.options.model,
              compare: input.options.compare,
              projectId: ctx.projectId,
            },
            ctx.signal,
          ),
        ),
    }),
    "calibration accept": cliCommand({
      summary:
        "Explicitly accept the primary configuration after reviewing a current test report",
      description:
        "Accepts the exact complete report's primary resolved fingerprints, including private fallbacks. Review incorrect-case counts first; acceptance records your decision, not a claim of perfect accuracy. Comparison never selects a winner. Stale/partial reports are refused.",
      positionals: [id],
      options: {
        json,
        run: {
          type: "string",
          required: true,
          description:
            "Evaluation report ID returned by judge test (not a case run ID)",
        },
      },
      run: (input, ctx) =>
        output(() =>
          api.calibration.accept(
            input.positionals.id,
            input.options.run,
            ctx.signal,
          ),
        ),
    }),
  };
}
