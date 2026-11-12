import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ExecutionDefaults } from "../soul/contracts.ts";

// This is a current catalog check, not a guarantee of later provider availability.
export async function validateRestoredModels(
  bb: BbPluginApi,
  hostId: string,
  defaults: ExecutionDefaults,
  signal: AbortSignal,
) {
  const choices: Array<ExecutionDefaults["main"] | null> = [
    defaults.main,
    defaults.worker,
    defaults.fallback,
  ].filter((choice) => choice && Object.keys(choice).length > 0);
  if (choices.length === 0) return;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const host = await bb.sdk.hosts.get({ hostId, signal: bounded });
  if (host.status !== "connected")
    throw new Error(
      "Execution restore requires the original machine to be connected; select other records or reconnect it.",
    );
  for (const choice of choices) {
    if (!choice) continue;
    bounded.throwIfAborted();
    const catalog = await bb.sdk.providers.models({
      hostId,
      providerId: choice.providerId,
      preferCached: false,
      signal: bounded,
    });
    bounded.throwIfAborted();
    const provider = choice.providerId
      ? catalog.providers.find((p) => p.id === choice.providerId)
      : catalog.providers[0];
    if (!provider?.available || catalog.modelLoadError)
      throw new Error(
        "Saved execution provider/catalog is unavailable. Reconnect/sign in or deliberately choose current defaults before restoring execution.",
      );
    const model = choice.model
      ? catalog.models.find(
          (m) => m.model === choice.model || m.id === choice.model,
        )
      : catalog.models.find((m) => m.isDefault);
    if (choice.model && !model)
      throw new Error(
        "Saved model is not in the current catalog. Choose a supported model explicitly; no fallback was selected.",
      );
    if (
      choice.reasoningLevel &&
      (!model ||
        model.reasoningDiscovery === "unknown" ||
        !model.supportedReasoningEfforts.some(
          (r) => r.reasoningEffort === choice.reasoningLevel,
        ))
    )
      throw new Error(
        "Saved reasoning choice cannot be verified against the current model catalog.",
      );
    if (choice.permissionMode) {
      const ranks = { "accept-edits": 0, auto: 1, full: 2 };
      if (
        ranks[catalog.permissionCeiling] === undefined ||
        ranks[choice.permissionMode] > ranks[catalog.permissionCeiling] ||
        !provider.capabilities.permissionModes.includes(choice.permissionMode)
      )
        throw new Error(
          "Saved permission mode exceeds the current machine/provider support. Choose defaults explicitly.",
        );
    }
    if (choice.serviceTier) {
      const tiers = model?.supportedServiceTiers ?? provider.serviceTiers ?? [];
      if (
        !provider.capabilities.supportsServiceTier ||
        (choice.serviceTier !== "default" &&
          !tiers.some((tier) => tier.id === choice.serviceTier))
      )
        throw new Error(
          "Saved service tier is unavailable or unknown in the current catalog.",
        );
    }
  }
}
