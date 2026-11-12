import type { DevelopmentStatus } from "./contracts.ts";

export function developmentStatus(): DevelopmentStatus {
  return {
    pluginId: "bbots",
    stage: "interface",
    automaticMaintenance: "disabled",
    automaticContinuity: "disabled",
    limitations: [
      "Original create/open behavior and explicit owned-worker CLI passed bounded Dev checks. Native UI/settings correction, task sources, commitments and manual memory/capture and checkpoint/export/restore and continuation preparation remain offline previews pending their scoped acceptance.",
      "Applied soul revision is unknown: configure resolution is not a provider-session receipt; live sessions may retain old guidance.",
      "Native Stop applies per thread; Bots cannot veto other plugins' actions.",
      "Automatic maintenance, fallback and conversation transitions are disabled.",
    ],
  };
}

export function formatStatus(status: DevelopmentStatus): string {
  return [
    "Bots: create/open preview",
    `Automatic maintenance: ${status.automaticMaintenance}`,
    `Automatic continuity: ${status.automaticContinuity}`,
    ...status.limitations,
    "",
  ].join("\n");
}
