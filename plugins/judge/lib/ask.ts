import { randomUUID } from "node:crypto";
import { askSchema } from "./api-contract.ts";
import { parseRequest } from "./contracts.ts";
import type { InferenceService } from "./inference.ts";
import type { JudgeRepository } from "./storage.ts";
import { parseVerdict, type StepResult, type Verdict } from "./results.ts";

/** Explicit state only. Source collection and saved-set execution have separate boundaries. */
export class AskService {
  private inference: InferenceService;
  private repository: JudgeRepository;
  constructor(inference: InferenceService, repository: JudgeRepository) {
    this.inference = inference;
    this.repository = repository;
  }

  async ask(value: unknown, signal?: AbortSignal): Promise<Verdict> {
    const input = askSchema.parse(value);
    const request = parseRequest({
      model: "validation",
      state: input.state,
      questions: input.questions,
    });
    const startedAt = Date.now();
    const outcome = await this.inference.ask({
      state: request.state,
      questions: request.questions,
      selection: { override: input.model, sensitive: !input.notPrivate },
      signal,
    });
    const result = outcome.result;
    const step: StepResult =
      result.status === "ran"
        ? {
            status: "ran",
            requestedModel: outcome.requestedModel!,
            resolvedModel: outcome.resolvedModel!,
            providerModel: result.providerModel,
            fallbackReason: outcome.fallbackReason ?? null,
            answers: result.answers,
            outcomes: {},
            latencyMs: result.latencyMs,
            inputTokens: result.inputTokens,
            cacheHit: false,
            provenance: {},
          }
        : { status: "unavailable", reason: result.reason, code: result.code };
    const verdict = parseVerdict({
      runId: randomUUID(),
      set: null,
      threadId: input.threadId ?? null,
      projectId: input.projectId ?? null,
      startedAt,
      endedAt: Date.now(),
      complete: step.status === "ran",
      calibrated: false,
      steps: { main: step },
      outcomes: {},
    });
    // Never return a verdict claiming success if its transaction did not commit.
    return this.repository.saveRun(verdict);
  }
}
