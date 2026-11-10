import type { ReactNode } from "react";
import type { z } from "zod";
import {
  experimental_InfoSection as InfoSection,
  experimental_SourceCode as SourceCode,
} from "@get-bb/plugin-sdk/app";
import type { detectionSchema } from "../lib/detection-schema.ts";
import { SettingsGroup, SettingsRow } from "./settings-row.tsx";
export function SetupDetection({
  plan,
  children,
}: {
  plan: z.infer<typeof detectionSchema>;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <InfoSection label="Setup and cleanup">
        <SettingsGroup>
          <SettingsRow
            label="Detected scripts"
            description="As of the current checkout. New worktrees read their own committed copy, which may differ."
          >
            <p className="max-w-64 text-xs text-muted-foreground">
              {plan.source === "bb-hook"
                ? `bb runs ${[plan.hooks.setup ? ".bb-env-setup.sh" : null, plan.hooks.teardown ? ".bb-env-teardown.sh" : null].filter(Boolean).join(" and ")} itself. The plugin runs no scripts.`
                : plan.source === "codex"
                  ? "From .codex/environments/environment.toml"
                  : "No scripts found"}
            </p>
          </SettingsRow>
          {plan.error && (
            <p role="alert" className="text-xs text-destructive">
              {plan.error}
            </p>
          )}
          {children ??
            (["setup", "cleanup"] satisfies ("setup" | "cleanup")[]).map(
              (step) => (
                <div key={step} className="space-y-2">
                  <p className="text-sm">
                    {step === "setup" ? "Setup" : "Cleanup"}
                  </p>
                  <div className="max-h-48 overflow-auto rounded-md border border-border">
                    <SourceCode
                      content={plan[step] ?? "none"}
                      path={`${step}.sh`}
                      overflow="wrap"
                    />
                  </div>
                </div>
              ),
            )}
        </SettingsGroup>
      </InfoSection>
      <SettingsGroup>
        <SettingsRow
          label="Copied files"
          description="Matching .worktreeinclude files, listed by name only."
        >
          <div className="max-w-64 text-xs text-muted-foreground">
            {!plan.sharedFiles.patternFile ? (
              "No .worktreeinclude in this project"
            ) : plan.sharedFiles.files.length === 0 ? (
              "No matching files."
            ) : (
              <ul className="space-y-1 font-mono">
                {plan.sharedFiles.files.map((file) => (
                  <li className="break-all" key={file}>
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
