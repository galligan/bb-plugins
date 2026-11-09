// bb-plugin-wt — the frontend entry. Its one job is the "Branch from:" control
// shown beside the Worktree+ provider in the New Thread environment picker.
//
// React and @get-bb/plugin-sdk/app are provided by bb at load time and are
// never bundled, so this file only runs inside bb.

import { useEffect } from "react";
import {
  definePluginApp,
  experimental_BranchPicker as BranchPicker,
  useSdk,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";

import { readBase, toInputs } from "./lib/base-input.ts";

const PROVIDER_ID = "wt";

function BaseBranchInput({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const sdk = useSdk();
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const base = readBase(value);

  // With nothing picked, fill in the project's default base so the control
  // shows the branch the worktree will really start from. If it cannot be
  // read, the inputs stay empty and the host picks the default itself.
  useEffect(() => {
    if (base !== null || projectId === null || hostId === null) return;
    let stale = false;
    sdk.projects
      .branches({ projectId, hostId })
      .then((result) => {
        const fallback = result.defaultWorktreeBaseBranch;
        if (!stale && fallback !== null) {
          onChange({ status: "ready", value: toInputs(fallback) });
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [base, projectId, hostId, sdk, onChange]);

  return (
    <BranchPicker
      hostId={hostId}
      projectId={projectId}
      value={base}
      onChange={(next) => onChange({ status: "ready", value: toInputs(next) })}
      label="Branch from:"
      placeholder="default branch"
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: PROVIDER_ID,
    component: BaseBranchInput,
  });
});
