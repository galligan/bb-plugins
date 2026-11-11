/** Only these fixed, non-sensitive domain reasons may cross the RPC boundary. */
export const PUBLIC_DOMAIN_ERRORS: ReadonlySet<string> = new Set([
  "missing_set",
  "missing_model",
  "missing_trigger",
  "unknown_badge_outcome",
  "private_model_required",
  "calibration_not_current",
]);

export function message(error: unknown): string {
  const fields =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code = typeof fields.code === "string" ? fields.code : "";
  const detail = typeof fields.message === "string" ? fields.message : "";
  const hints: Record<string, string> = {
    invalid_input: "Check the IDs, required fields, JSON and model limits.",
    invalid: "Check the IDs, required fields, JSON and model limits.",
    missing_set:
      "Choose an existing saved set. Import sets with bb judge questions import.",
    missing_model: "Save this model first.",
    missing_trigger:
      "This binding no longer exists. Refresh bindings before editing or enabling it.",
    unknown_badge_outcome:
      "Badge keys must name the saved set's final outcomes.",
    persistence_failed:
      "Judge could not read or save its local records. Retry; check plugin logs if it persists.",
    private_model_required:
      "Choose a saved model that explicitly permits private data before selecting it as the private fallback.",
    calibration_not_current:
      "Run and review a fresh complete case report for the current set and model policy before accepting it.",
    calibration_unavailable:
      "Review a complete, current primary case report before accepting calibration.",
  };
  return (
    (error instanceof SyntaxError ? hints.invalid : undefined) ??
    (Object.hasOwn(hints, detail) ? hints[detail] : undefined) ??
    (Object.hasOwn(hints, code) ? hints[code] : undefined) ??
    "Judge could not complete this request. Refresh and check the saved configuration or plugin logs."
  );
}
