import type { DevelopmentStatus } from "./contracts.ts";

export function developmentStatus(): DevelopmentStatus {
  return {
    pluginId: "bbots",
    stage: "creation",
    automaticMaintenance: "disabled",
    automaticContinuity: "disabled",
    limitations: [
      "Creation is a development preview; management UI, soul editing and model controls are not available yet.",
      "Native Stop applies per thread; Bots cannot veto other plugins' actions.",
      "Automatic maintenance, fallback and conversation transitions are disabled.",
    ],
  };
}

export function formatStatus(status: DevelopmentStatus): string {
  return [
    "Bots: creation foundation",
    `Automatic maintenance: ${status.automaticMaintenance}`,
    `Automatic continuity: ${status.automaticContinuity}`,
    ...status.limitations,
    "",
  ].join("\n");
}
