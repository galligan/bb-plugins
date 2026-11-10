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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loading } from "./loading.tsx";
import { BranchSettings } from "./branch-settings.tsx";
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
      <Loading label="Loading project settings…" />
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
      toast.success("Project settings saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <BranchSettings
        current={current}
        onChange={(branch) => setDraft({ ...current, ...branch })}
        busy={busy}
        validPrefix={validPrefix}
        preview={preview}
      />
      {detectionError && (
        <p role="alert" className="text-xs text-destructive">
          Setup detection: {detectionError}
        </p>
      )}
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={
            busy ||
            !valid ||
            JSON.stringify(current) === JSON.stringify(initial)
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
