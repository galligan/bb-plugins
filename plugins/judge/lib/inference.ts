import { parseRequest } from "./contracts.ts";
import { Deadline, OperationAborted } from "./deadline.ts";
import { systemOne, type InferenceResult } from "./transports/systemone.ts";
import { workersAI } from "./transports/workers-ai.ts";
import type { ModelService, ModelIdentity } from "./models.ts";
import type { ModelSelection } from "./privacy.ts";
import type { Json } from "./json.ts";

export type InferenceOutcome = {
  result: InferenceResult;
  requestedModel?: string;
  resolvedModel?: ModelIdentity;
  fallbackReason?: "private_not_allowed" | null;
};

export class InferenceService {
  private models: ModelService;
  private disposal = new AbortController();
  private fetcher: typeof fetch;
  constructor(models: ModelService, fetcher: typeof fetch = fetch) {
    this.models = models;
    this.fetcher = fetcher;
  }
  dispose(): void {
    this.disposal.abort();
  }

  async ask(input: {
    state: Json;
    questions: unknown;
    selection: ModelSelection;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<InferenceOutcome> {
    // Validate before policy resolution; do not turn malformed arguments into outages.
    const validated = parseRequest({
      model: "validation",
      state: input.state,
      questions: input.questions,
    });
    const start = performance.now();
    const deadlineAt = input.deadlineAt ?? start + 5_000;
    const scope = new Deadline({
      signals: [input.signal, this.disposal.signal],
      deadlineAt,
    });
    try {
      return await scope.run(async () => {
        const result = await this.models.usingModel(
          input.selection,
          async (prepared) => {
            const changed = new AbortController();
            const unsubscribe = this.models.onInvalidate(() => changed.abort());
            try {
              const transport =
                prepared.model.connection === "cloudflare"
                  ? workersAI
                  : systemOne;
              const response: InferenceResult = await transport({
                model: prepared.model,
                ...prepared.connection,
                questions: validated.questions,
                state: validated.state,
                deadlineAt,
                signals: [scope.signal, changed.signal],
                fetcher: this.fetcher,
              });
              return {
                result: response,
                requestedModel: prepared.requestedModel,
                resolvedModel: prepared.identity,
                fallbackReason: prepared.fallbackReason,
              };
            } finally {
              unsubscribe();
            }
          },
        );
        return result.ok
          ? result.value
          : {
              result: {
                status: "unavailable" as const,
                reason: result.reason,
                code: result.code,
                latencyMs: performance.now() - start,
              },
            };
      });
    } catch (error) {
      if (error instanceof OperationAborted)
        return {
          result: {
            status: "unavailable",
            reason: error.reason,
            code: error.reason,
            latencyMs: performance.now() - start,
          },
        };
      throw error;
    } finally {
      scope.close();
    }
  }
}
