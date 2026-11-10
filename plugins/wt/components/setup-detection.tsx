import type { z } from "zod";
import type { detectionSchema } from "../lib/detection-schema.ts";
export function SetupDetection({
  plan,
}: {
  plan: z.infer<typeof detectionSchema>;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Setup and cleanup</h3>
      <p className="text-sm">
        Detected as of the current checkout. New worktrees read their own
        committed copy, which may differ.
      </p>
      <p>
        {plan.source === "bb-hook"
          ? `bb runs ${[plan.hooks.setup ? ".bb-env-setup.sh" : null, plan.hooks.teardown ? ".bb-env-teardown.sh" : null].filter(Boolean).join(" and ")} itself. The plugin runs no scripts.`
          : plan.source === "codex"
            ? "From .codex/environments/environment.toml"
            : "No scripts found"}
      </p>
      {plan.error && <p role="alert">{plan.error}</p>}
      {(["setup", "cleanup"] satisfies ("setup" | "cleanup")[]).map((step) => (
        <div key={step}>
          <h4>{step === "setup" ? "Setup" : "Cleanup"}</h4>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-state-hover p-3 font-mono text-xs">
            {plan[step] ?? "none"}
          </pre>
        </div>
      ))}
      <h3 className="font-semibold">Copied files</h3>
      {!plan.sharedFiles.patternFile ? (
        <p>No .worktreeinclude in this project</p>
      ) : plan.sharedFiles.files.length === 0 ? (
        <p>No matching files.</p>
      ) : (
        <ul className="list-disc pl-5 font-mono text-xs">
          {plan.sharedFiles.files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
