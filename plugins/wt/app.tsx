// Worktree+ frontend registration: provider inputs and management panel.

import { useEffect } from "react";
import {
  definePluginApp,
  experimental_BranchPicker as BranchPicker,
  useRpc,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";

import { ProjectsSettings } from "./components/projects-settings.tsx";
import { WorktreesPanel } from "./components/worktrees-panel.tsx";
import { WorktreesHeader } from "./components/worktrees-header.tsx";

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
  app.slots.settingsSection({
    id: "projects",
    title: "Projects",
    description: "Branch naming and detected setup for each project.",
    component: ProjectsSettings,
  });
  app.slots.navPanel({
    id: "worktrees",
    title: "Worktrees",
    icon: "FolderGit",
    path: "worktrees",
    component: WorktreesPanel,
    headerContent: WorktreesHeader,
  });
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: PROVIDER_ID,
    component: BaseBranchInput,
  });
});
