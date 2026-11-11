import type { DevelopmentStatus } from "./contracts.ts";

export function developmentStatus(): DevelopmentStatus {
  return {
    pluginId: "bbots",
    stage: "skeleton",
    automaticMaintenance: "disabled",
    automaticContinuity: "disabled",
    limitations: [
      "Bot creation, persistent identity and SOUL.md are not implemented yet.",
      "Native Stop applies per thread; Bots cannot veto other plugins' actions.",
      "Automatic maintenance, fallback and conversation transitions are disabled.",
    ],
  };
}

export function formatStatus(status: DevelopmentStatus): string {
  return [
    "Bots: development skeleton",
    `Automatic maintenance: ${status.automaticMaintenance}`,
    `Automatic continuity: ${status.automaticContinuity}`,
    ...status.limitations,
    "",
  ].join("\n");
}
