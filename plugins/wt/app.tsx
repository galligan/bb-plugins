// bb-plugin-wt — the frontend entry. Its one job is the "Branch from:" control
// shown beside the Worktree+ provider in the New Thread environment picker.
//
// React and @get-bb/plugin-sdk/app are provided by bb at load time and are
// never bundled, so this file only runs inside bb.

import { useEffect } from "react";
import {
  definePluginApp,
  experimental_BranchPicker as BranchPicker,
  useRpc,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";

import { readBase, toInputs } from "./lib/base-input.ts";
import type { rpcContract } from "./server.ts";

const PROVIDER_ID = "wt";

function BaseBranchInput({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof rpcContract>();
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const base = readBase(value);

  // With nothing picked, ask the machine which base it would use and fill it
  // in, so the control shows the branch the worktree will really start from.
  // If that fails, the inputs stay empty and the machine decides at launch.
  useEffect(() => {
    if (base !== null || projectId === null || hostId === null) return;
    let stale = false;
    rpc
      .call("defaultBase", { projectId, hostId })
      .then((result) => {
        if (!stale && result.base !== null) {
          onChange({ status: "ready", value: toInputs(result.base) });
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [base, projectId, hostId, rpc, onChange]);

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
