import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { branchName, isValidBranchPrefix } from "../lib/branch-name.ts";
import {
  projectScriptsSchema,
  type ProjectScripts,
} from "../lib/script-overrides.ts";
import { ScriptSettings } from "./script-settings.tsx";
import { SetupDetection } from "./setup-detection.tsx";

type Settings = z.infer<typeof rpcContract.projectSettings.output>;
type Detection = z.infer<typeof rpcContract.detectSetup.output>;
const detectedScripts: ProjectScripts = {
  setup: { mode: "detected", script: null },
  cleanup: { mode: "detected", script: null },
};
type Draft = {
  scripts: ProjectScripts;
  custom: boolean;
  prefixBranches: boolean;
  branchPrefix: string;
};
function draftOf(settings: Settings): Draft {
  return {
    custom:
      settings.stored?.branchPrefix != null ||
      settings.stored?.prefixBranches != null,
    ...settings.effective,
    scripts: settings.stored?.scripts ?? detectedScripts,
  };
}
export function ProjectForm({
  projectId,
  hostId,
}: {
  projectId: string;
  hostId: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Settings | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    rpc
      .call("projectSettings", { projectId })
      .then((settings) => {
        if (stale) return;
        setData(settings);
        setDraft(draftOf(settings));
        setInitial(draftOf(settings));
      })
      .catch((error) => {
        if (!stale)
          setError(error instanceof Error ? error.message : String(error));
      });
    rpc
      .call("detectSetup", { projectId, hostId })
      .then((plan) => {
        if (!stale) setDetection(plan);
      })
      .catch((error) => {
        if (!stale)
          setDetectionError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      stale = true;
    };
  }, [rpc, projectId, hostId]);
  if (!data || !draft)
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <p role="status">Loading project settings…</p>
    );
  const current = draft;
  const validPrefix =
    !current.custom || isValidBranchPrefix(current.branchPrefix);
  const valid =
    validPrefix && projectScriptsSchema.safeParse(current.scripts).success;
  const effective = current.custom ? current : data.global;
  const preview = branchName({
    suggested: `${data.managedBranchPrefix}fix-login-bug-thr_example`,
    bbPrefix: data.managedBranchPrefix,
    pluginPrefix: effective.branchPrefix,
    enabled: effective.prefixBranches,
  });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await rpc.call("setProjectSettings", {
        projectId,
        patch: {
          prefixBranches: current.custom ? current.prefixBranches : null,
          branchPrefix: current.custom ? current.branchPrefix : null,
          scripts:
            current.scripts.setup.mode === "detected" &&
            current.scripts.cleanup.mode === "detected"
              ? null
              : current.scripts,
        },
      });
      setData(saved);
      setDraft(draftOf(saved));
      setInitial(draftOf(saved));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <fieldset disabled={busy} className="space-y-3">
        <legend className="font-semibold">Branch naming</legend>
        <label className="block">
          Branch settings
          <select
            className="ml-2 rounded border border-border bg-background p-1"
            value={current.custom ? "custom" : "global"}
            onChange={(event) =>
              setDraft({ ...current, custom: event.target.value === "custom" })
            }
          >
            <option value="global">Use global setting</option>
            <option value="custom">Custom for this project</option>
          </select>
        </label>
        {current.custom && (
          <>
            <label className="block">
              <input
                type="checkbox"
                checked={current.prefixBranches}
                onChange={(event) =>
                  setDraft({ ...current, prefixBranches: event.target.checked })
                }
              />{" "}
              Prefix worktree branches
            </label>
            <label className="block">
              Branch prefix
              <input
                className="ml-2 rounded border border-border bg-background p-1 font-mono"
                value={current.branchPrefix}
                onChange={(event) =>
                  setDraft({ ...current, branchPrefix: event.target.value })
                }
                aria-invalid={!validPrefix}
              />
            </label>
            <p className="text-sm">Leave empty to use bb's branch prefix.</p>
            {!validPrefix && (
              <p role="alert">Not a valid start for a git branch name</p>
            )}
          </>
        )}
        <p className="text-sm">
          Example for “Fix login bug”:{" "}
          <code className="break-all">{preview}</code>
        </p>
      </fieldset>
      {detectionError && <p role="alert">Setup detection: {detectionError}</p>}
      {detection && (
        <SetupDetection plan={detection}>
          <ScriptSettings
            plan={detection}
            value={current.scripts}
            onChange={(scripts) => setDraft({ ...current, scripts })}
            disabled={busy}
          />
        </SetupDetection>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="rounded border border-border px-3 py-1"
        disabled={
          busy || !valid || JSON.stringify(current) === JSON.stringify(initial)
        }
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
