import type { useSdk } from "@get-bb/plugin-sdk/app";

type Sdk = ReturnType<typeof useSdk>;
export const provider: Awaited<ReturnType<Sdk["providers"]["list"]>>[number] = {
  id: "codex",
  pluginId: "provider-codex",
  displayName: "Codex",
  available: true,
  logoUrl: null,
  maintenance: { health: true, usage: true, installation: true },
  completedTurnDisplay: "collapse",
  composerActions: [],
  capabilities: {
    modelCatalogScope: "host",
    permissionModes: ["accept-edits", "auto", "full"],
    supportsFork: true,
    supportsNativeUserQuestion: false,
    supportsServiceTier: true,
    supportsSessionRewind: true,
    supportsThreadArchive: true,
    supportsThreadRename: true,
  },
};
export const execution: Awaited<ReturnType<Sdk["providers"]["models"]>> = {
  providers: [provider],
  permissionCeiling: "auto",
  modelLoadError: null,
  selectedOnlyModels: [],
  models: [
    {
      id: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      displayName: "Sol",
      description: "Fixture model",
      isDefault: true,
      defaultReasoningEffort: "high",
      reasoningDiscovery: "known",
      supportedReasoningEfforts: [
        { reasoningEffort: "high", description: "High" },
      ],
      supportedServiceTiers: [{ id: "fast" }],
    },
  ],
};
