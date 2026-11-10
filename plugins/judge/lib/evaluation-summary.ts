import type {
  EvaluationCase,
  CaseEvaluation,
  VariantEvaluation,
} from "./evaluation-contract.ts";

export function summarize(cases: EvaluationCase[], results: CaseEvaluation[]) {
  const counts = { correct: 0, incorrect: 0, unavailable: 0 };
  const steps = { ran: 0, skipped: 0, unavailable: 0 };
  const outcomes = Object.fromEntries(
    Object.keys(cases[0]!.expect)
      .sort()
      .map((id) => [
        id,
        {
          correct: 0,
          incorrect: 0,
          unavailable: 0,
          accuracy: null as number | null,
        },
      ]),
  );
  for (const [index, result] of results.entries()) {
    counts[result.status]++;
    for (const key of ["ran", "skipped", "unavailable"] as const)
      steps[key] += result.steps[key];
    for (const [id, rate] of Object.entries(outcomes)) {
      if (result.status === "unavailable") rate.unavailable++;
      else if (result.outcomes[id] === cases[index]!.expect[id]) rate.correct++;
      else rate.incorrect++;
    }
  }
  for (const rate of Object.values(outcomes)) {
    const available = rate.correct + rate.incorrect;
    rate.accuracy = available ? rate.correct / available : null;
  }
  return { counts, steps, outcomes };
}

export function compare(variants: Pick<VariantEvaluation, "results">[]) {
  if (variants.length !== 2) return [];
  return variants[0]!.results.map((a, index) => {
    const b = variants[1]!.results[index]!;
    const available = a.status !== "unavailable" && b.status !== "unavailable";
    const outcomes = available
      ? Object.keys(a.outcomes)
          .sort()
          .filter((id) => a.outcomes[id] !== b.outcomes[id])
      : [];
    return {
      index,
      status: !available
        ? ("unavailable" as const)
        : outcomes.length
          ? ("disagree" as const)
          : ("agree" as const),
      outcomes,
    };
  });
}
