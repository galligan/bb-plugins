import { useId } from "react";
import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { detectionSchema } from "../lib/detection-schema.ts";
import type { ProjectScripts } from "../lib/script-overrides.ts";
import { projectScriptsSchema } from "../lib/script-overrides.ts";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { SettingsRow } from "./settings-row.tsx";
export function ScriptSettings({
  plan,
  value,
  onChange,
  disabled,
}: {
  plan: z.infer<typeof detectionSchema>;
  value: ProjectScripts;
  onChange: (next: ProjectScripts) => void;
  disabled: boolean;
}) {
  const core = plan.source === "bb-hook";
  const id = useId();
  return (
    <div className="space-y-4">
      {core && (
        <p className="text-xs text-muted-foreground">
          Project script modes are ignored while a bb hook is present. bb core
          runs the hooks itself.
        </p>
      )}
      {plan.error !== null && !core && (
        <p className="text-xs text-muted-foreground">
          Detection is incomplete. Paste the complete script when choosing
          Custom.
        </p>
      )}
      <fieldset disabled={disabled || core} className="min-w-0 space-y-4">
        {(["setup", "cleanup"] satisfies ("setup" | "cleanup")[]).map(
          (step) => {
            const current = value[step];
            const title = step === "setup" ? "Setup" : "Cleanup";
            const valid = projectScriptsSchema.shape[step].safeParse(current);
            return (
              <div key={step} className="space-y-2">
                <SettingsRow
                  label={title}
                  description={
                    step === "setup"
                      ? "Runs after creating a worktree."
                      : "Runs before the safety inspection on removal."
                  }
                >
                  <RadioGroup
                    aria-label={`${title} mode`}
                    disabled={disabled || core}
                    value={current.mode}
                    className="flex flex-wrap gap-3"
                    onValueChange={(mode) => {
                      if (
                        mode !== "detected" &&
                        mode !== "custom" &&
                        mode !== "off"
                      )
                        return;
                      onChange({
                        ...value,
                        [step]: {
                          mode,
                          script:
                            mode === "custom" && current.script === null
                              ? plan.error === null
                                ? (plan[step] ?? "")
                                : ""
                              : current.script,
                        },
                      });
                    }}
                  >
                    {(
                      ["detected", "custom", "off"] satisfies (
                        "detected" | "custom" | "off"
                      )[]
                    ).map((mode) => (
                      <div key={mode} className="flex items-center gap-1.5">
                        <RadioGroupItem
                          id={`${id}-${step}-${mode}`}
                          value={mode}
                        />
                        <label
                          htmlFor={`${id}-${step}-${mode}`}
                          className="text-xs"
                        >
                          {mode === "detected"
                            ? "Detected"
                            : mode === "custom"
                              ? "Custom"
                              : "Off"}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </SettingsRow>
                {current.mode === "custom" ? (
                  <Textarea
                    aria-label={`${title} script`}
                    disabled={disabled || core}
                    className="min-h-32 font-mono text-xs"
                    value={current.script ?? ""}
                    aria-invalid={!valid.success}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [step]: { ...current, script: event.target.value },
                      })
                    }
                  />
                ) : (
                  <div className="max-h-48 overflow-auto rounded-md border border-border">
                    <SourceCode
                      content={
                        current.mode === "off"
                          ? "Disabled"
                          : (plan[step] ?? "none")
                      }
                      path={`${step}.sh`}
                      overflow="wrap"
                    />
                  </div>
                )}
                {!valid.success && (
                  <p role="alert" className="text-xs text-destructive">
                    {valid.error.issues[0]?.message}
                  </p>
                )}
              </div>
            );
          },
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Scripts are stored in bb’s database in plain text. Scripts run on the
        machine that owns the checkout, with your user's permissions. Do not put
        secrets here. Changes apply to new worktrees. Cleanup uses the scripts
        recorded when the worktree was created.
      </p>
    </div>
  );
}
