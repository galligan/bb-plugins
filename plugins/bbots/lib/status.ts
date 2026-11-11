import type { DevelopmentStatus } from "./contracts.ts";

export function developmentStatus(): DevelopmentStatus {
  return {
    pluginId: "bbots",
    stage: "storage",
    automaticMaintenance: "disabled",
    automaticContinuity: "disabled",
    limitations: [
      "Revisioned storage is ready; bot creation, homes and soul binding are not available yet.",
      "Native Stop applies per thread; Bots cannot veto other plugins' actions.",
      "Automatic maintenance, fallback and conversation transitions are disabled.",
    ],
  };
}

export function formatStatus(status: DevelopmentStatus): string {
  return [
    "Bots: storage foundation",
    `Automatic maintenance: ${status.automaticMaintenance}`,
    `Automatic continuity: ${status.automaticContinuity}`,
    ...status.limitations,
    "",
  ].join("\n");
}
