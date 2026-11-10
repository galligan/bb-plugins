import type { z } from "zod";
import type { detectionSchema } from "../lib/detection-schema.ts";
import type { ProjectScripts } from "../lib/script-overrides.ts";
import { projectScriptsSchema } from "../lib/script-overrides.ts";

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
  return (
    <div className="space-y-4">
      {core && (
        <p>
          Project script modes are ignored while a bb hook is present. bb core
          runs the hooks itself.
        </p>
      )}
      <fieldset disabled={disabled || core} className="space-y-4">
        {(["setup", "cleanup"] satisfies ("setup" | "cleanup")[]).map(
          (step) => {
            const current = value[step];
            const title = step === "setup" ? "Setup" : "Cleanup";
            const valid = projectScriptsSchema.shape[step].safeParse(current);
            return (
              <div key={step} className="space-y-2">
                <label className="block">
                  {title} mode
                  <select
                    className="ml-2 rounded border border-border bg-background p-1"
                    value={current.mode}
                    onChange={(event) => {
                      const mode = event.target.value;
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
                              ? (plan[step] ?? "")
                              : current.script,
                        },
                      });
                    }}
                  >
                    <option value="detected">Detected</option>
                    <option value="custom">Custom</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                {current.mode === "custom" ? (
                  <label className="block text-sm">
                    {title} script
                    <textarea
                      className="mt-1 block min-h-32 w-full rounded border border-border bg-background p-2 font-mono text-xs"
                      value={current.script ?? ""}
                      aria-invalid={!valid.success}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          [step]: { ...current, script: event.target.value },
                        })
                      }
                    />
                  </label>
                ) : (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-state-hover p-3 font-mono text-xs">
                    {current.mode === "off"
                      ? "Disabled"
                      : (plan[step] ?? "none")}
                  </pre>
                )}
                {!valid.success && (
                  <p role="alert" className="text-sm">
                    {valid.error.issues[0]?.message}
                  </p>
                )}
              </div>
            );
          },
        )}
      </fieldset>
      <p className="text-sm">
        Scripts are stored in bb’s database in plain text. Scripts run on the
        machine that owns the checkout, with your user's permissions. Do not put
        secrets here. Changes apply to new worktrees. Cleanup uses the scripts
        recorded when the worktree was created.
      </p>
    </div>
  );
}
