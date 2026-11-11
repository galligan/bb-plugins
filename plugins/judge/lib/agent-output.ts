import { runSummarySchema, type Verdict } from "./results.ts";
export const AGENT_OUTPUT_BYTES = 64 * 1024;
/** Omit whole answers, never clip a typed distribution or invent a partial answer. */
export function agentOutput(run: Verdict): string {
  const full = JSON.stringify({ kind: "verdict", verdict: run });
  if (Buffer.byteLength(full, "utf8") <= AGENT_OUTPUT_BYTES) return full;
  const { steps, outcomes, ...header } = run;
  const summary = JSON.stringify({
    kind: "summary",
    verdict: {
      ...runSummarySchema.parse(header),
      outcomes,
      steps: Object.fromEntries(
        Object.entries(steps).map(([id, step]) => [
          id,
          step.status === "ran"
            ? {
                status: step.status,
                requestedModel: step.requestedModel,
                resolvedModel: step.resolvedModel,
                ...(step.providerModel === undefined
                  ? {}
                  : { providerModel: step.providerModel }),
                fallbackReason: step.fallbackReason,
                latencyMs: step.latencyMs,
                inputTokens: step.inputTokens,
                cacheHit: step.cacheHit,
              }
            : step,
        ]),
      ),
    },
    answersOmitted: true,
    detail:
      "Answers exceeded the tool output limit. The full persisted verdict is available through Judge RPC runs.get with this runId.",
  });
  if (Buffer.byteLength(summary, "utf8") > AGENT_OUTPUT_BYTES)
    throw new Error("tool_output_limit");
  return summary;
}
