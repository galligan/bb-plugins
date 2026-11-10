import { parseRequest } from "./contracts.ts";
import { Deadline, OperationAborted } from "./deadline.ts";
import { systemOne, type InferenceResult } from "./transports/systemone.ts";
import { workersAI } from "./transports/workers-ai.ts";
import type { ModelService, ModelIdentity } from "./models.ts";
import type { ModelSelection } from "./privacy.ts";
import { cacheDescriptor, type ResponseCache } from "./response-cache.ts";
import type { Json } from "./json.ts";

export type InferenceOutcome = {
  result: InferenceResult;
  requestedModel?: string;
  resolvedModel?: ModelIdentity;
  cacheHit?: boolean;
  fallbackReason?: "private_not_allowed" | null;
};

export class InferenceService {
  private models: ModelService;
  private disposal = new AbortController();
  private fetcher: typeof fetch;
  private cache?: ResponseCache;
  constructor(
    models: ModelService,
    fetcher: typeof fetch = fetch,
    cache?: ResponseCache,
  ) {
    this.models = models;
    this.fetcher = fetcher;
    this.cache = cache;
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
    bypassCache?: boolean;
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
              const generation = this.models.configurationGeneration();
              const request = cacheDescriptor(
                prepared.identity.fingerprint,
                prepared.model.connection === "cloudflare",
                validated.questions,
                validated.state,
              );
              scope.assertActive();
              // usingModel has freshly enforced privacy/settings before this lookup.
              const cached = input.bypassCache
                ? null
                : this.cache?.get(request, validated.questions);
              let response: InferenceResult;
              if (cached) {
                response = {
                  status: "ran",
                  providerModel: cached.model,
                  answers: cached.answers,
                  inputTokens: 0,
                  latencyMs: performance.now() - start,
                };
              } else
                response = await transport({
                  model: prepared.model,
                  ...prepared.connection,
                  questions: validated.questions,
                  state: validated.state,
                  deadlineAt,
                  signals: [scope.signal, changed.signal],
                  fetcher: this.fetcher,
                });
              scope.assertActive();
              if (
                changed.signal.aborted ||
                generation !== this.models.configurationGeneration()
              )
                throw new OperationAborted("cancelled");
              if (
                !cached &&
                !input.bypassCache &&
                response.status === "ran" &&
                this.cache
              ) {
                if (
                  !(await scope.run(() =>
                    this.models.isCurrent(prepared.identity),
                  ))
                )
                  throw new OperationAborted("cancelled");
                scope.assertActive();
                if (
                  changed.signal.aborted ||
                  generation !== this.models.configurationGeneration()
                )
                  throw new OperationAborted("cancelled");
                this.cache.put(request, validated.questions, response);
              }
              scope.assertActive();
              return {
                result: response,
                cacheHit: Boolean(cached),
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
