import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { definition, setupRunner } from "./runner-fixtures.ts";

export function evaluationDefinition() {
  return {
    ...definition(),
    calibratedFor: ["public"],
    outcomes: {
      accepted: { all: ["screen.ok", "detail.ok"] },
      claimed: "screen.ok",
    },
    cases: [
      {
        id: "positive",
        inputs: {
          screen: { provider: "POSITIVE_FIXTURE_ONLY" },
          detail: { reply: "POSITIVE_FIXTURE_ONLY" },
        },
        expect: { accepted: true, claimed: true },
      },
      {
        id: "negative",
        inputs: {
          screen: { provider: "NEGATIVE_FIXTURE_ONLY" },
          detail: { reply: "NEGATIVE_FIXTURE_ONLY" },
        },
        expect: { accepted: false, claimed: false },
      },
      {
        id: "incorrect",
        inputs: {
          screen: { provider: "INCORRECT_FIXTURE_ONLY" },
          detail: { reply: "INCORRECT_FIXTURE_ONLY" },
        },
        expect: { accepted: false, claimed: true },
      },
      {
        id: "unavailable",
        inputs: {
          screen: { provider: "UNAVAILABLE_FIXTURE_ONLY" },
          detail: { reply: "UNAVAILABLE_FIXTURE_ONLY" },
        },
        expect: { accepted: false, claimed: false },
      },
    ],
  };
}
export const recordedEvaluation: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const state = body.state as { provider?: string; reply?: string };
  if (state.provider === "UNAVAILABLE_FIXTURE_ONLY")
    return Response.json(
      { error: { message: "dummy-private-upstream-error" } },
      { status: 503 },
    );
  const noul =
    state.provider === "NEGATIVE_FIXTURE_ONLY" ||
    (body.model === "comparison-selector" && state.reply !== undefined)
      ? 0.05
      : 0.95;
  return Response.json({
    model: "recorded-evaluation-version",
    answers: { q: { type: "noul", noul } },
  });
};
export async function setupEvaluation<T extends { bb: BbPluginApi }>(
  host: T,
  fetcher: typeof fetch = recordedEvaluation,
) {
  const h = await setupRunner(host, fetcher);
  h.api.sets.save(JSON.stringify(evaluationDefinition()));
  return h;
}
