import type { ModelConfig } from "./contracts.ts";

export function inputIsSensitive(input: {
  origin: "ad_hoc" | "source" | "source_override";
  notPrivate?: boolean;
  sourceSensitive?: boolean;
}): boolean {
  if (input.origin === "ad_hoc") return input.notPrivate !== true;
  if (input.origin === "source_override") return true;
  return input.sourceSensitive !== false;
}

export function requestedModelId(selection: {
  override?: string;
  step?: string;
  set?: string;
  global?: string | null;
}): string | null {
  return (
    selection.override ??
    selection.step ??
    selection.set ??
    selection.global ??
    null
  );
}

export type ModelSelection = {
  override?: string;
  step?: string;
  set?: string;
  sensitive: boolean;
};
export type PolicyResolution =
  | {
      ok: true;
      requestedModel: string;
      model: ModelConfig;
      fallbackReason: "private_not_allowed" | null;
    }
  | {
      ok: false;
      reason: "not_configured" | "private_not_allowed";
      code: string;
    };

/** Run before cache lookup or transport access; only one explicit private fallback is allowed. */
export function resolvePrivacy(
  selection: ModelSelection,
  defaults: { defaultId: string | null; privateId: string | null },
  getModel: (id: string) => ModelConfig | null,
): PolicyResolution {
  const requested = requestedModelId({
    ...selection,
    global: defaults.defaultId,
  });
  if (!requested)
    return { ok: false, reason: "not_configured", code: "missing_default" };
  const model = getModel(requested);
  if (!model)
    return { ok: false, reason: "not_configured", code: "missing_model" };
  if (!selection.sensitive || model.allowPrivate)
    return { ok: true, requestedModel: requested, model, fallbackReason: null };
  const fallback = defaults.privateId ? getModel(defaults.privateId) : null;
  if (!fallback?.allowPrivate)
    return {
      ok: false,
      reason: "private_not_allowed",
      code: "private_model_required",
    };
  return {
    ok: true,
    requestedModel: requested,
    model: fallback,
    fallbackReason: "private_not_allowed",
  };
}
