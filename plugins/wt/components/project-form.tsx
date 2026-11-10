import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { branchName, isValidBranchPrefix } from "../lib/branch-name.ts";
import { SetupDetection } from "./setup-detection.tsx";

type Settings = z.infer<typeof rpcContract.projectSettings.output>;
type Detection = z.infer<typeof rpcContract.detectSetup.output>;
type Draft = { custom: boolean; prefixBranches: boolean; branchPrefix: string };
function draftOf(settings: Settings): Draft {
  return {
    custom:
      settings.stored?.branchPrefix != null ||
      settings.stored?.prefixBranches != null,
    ...settings.effective,
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
  const [detection, setDetection] = useState<Detection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    Promise.all([
      rpc.call("projectSettings", { projectId }),
      rpc.call("detectSetup", { projectId, hostId }),
    ])
      .then(([settings, plan]) => {
        if (stale) return;
        setData(settings);
        setDetection(plan);
        setDraft(draftOf(settings));
        setInitial(draftOf(settings));
      })
      .catch((error) => {
        if (!stale)
          setError(error instanceof Error ? error.message : String(error));
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
  const valid = !current.custom || isValidBranchPrefix(current.branchPrefix);
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
                aria-invalid={!valid}
              />
            </label>
            <p className="text-sm">Leave empty to use bb's branch prefix.</p>
            {!valid && (
              <p role="alert">Not a valid start for a git branch name</p>
            )}
          </>
        )}
        <p className="text-sm">
          Example for “Fix login bug”:{" "}
          <code className="break-all">{preview}</code>
        </p>
      </fieldset>
      {detection && <SetupDetection plan={detection} />}
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
