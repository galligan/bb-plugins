import {
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, modelPageSchema, logSchema } from "./api-contract.ts";
import { AskService } from "./ask.ts";
import { InferenceService } from "./inference.ts";
import { ValidationError } from "./json.ts";
import type { ModelService } from "./models.ts";
import type { JudgeRepository } from "./storage.ts";
import { PersistenceError } from "./storage.ts";
import { SetService } from "./sets.ts";
import { SourceService } from "./sources/service.ts";
import { Runner } from "./runner.ts";
import { TemplateService } from "./templates.ts";

export function publicError(error: unknown): string {
  if (error instanceof PersistenceError) return "persistence_failed";
  if (error instanceof z.ZodError || error instanceof ValidationError)
    return "invalid_input";
  return "operation_failed";
}

export class JudgeApi {
  readonly asks: AskService;
  readonly inference: InferenceService;
  readonly models: ModelService;
  readonly repository: JudgeRepository;
  readonly sets: SetService;
  readonly sources: SourceService;
  readonly runner: Runner;
  readonly templates: TemplateService;
  constructor(
    models: ModelService,
    repository: JudgeRepository,
    sdk: BbPluginApi["sdk"],
    fetcher: typeof fetch = fetch,
  ) {
    this.models = models;
    this.repository = repository;
    this.sets = new SetService(repository, models);
    this.templates = new TemplateService(this.sets);
    this.inference = new InferenceService(models, fetcher);
    this.asks = new AskService(this.inference, repository);
    this.sources = new SourceService(sdk);
    this.runner = new Runner(
      repository,
      this.sets,
      models,
      this.inference,
      this.sources,
      sdk,
    );
  }
  dispose(): void {
    this.runner.dispose();
    this.sources.dispose();
    this.inference.dispose();
  }

  list(value: unknown) {
    const input = modelPageSchema.parse(value);
    const rows = this.repository.pageModels(input.limit + 1, input.after);
    const models = rows.slice(0, input.limit);
    return {
      models,
      defaults: this.models.defaults(),
      next: rows.length > input.limit ? models.at(-1)!.id : null,
    };
  }
  log(value: unknown) {
    const input = logSchema.parse(value);
    const rows = this.repository.listRunSummaries(input);
    const runs = rows.slice(0, input.limit);
    const last = runs.at(-1);
    return {
      runs,
      next:
        rows.length > input.limit && last
          ? { startedAt: last.startedAt, runId: last.runId }
          : null,
    };
  }
  async check(id: string, probe = false, signal?: AbortSignal) {
    if (!probe) return this.models.readiness(id);
    return this.models.checkModel(
      id,
      async () => {
        const { result } = await this.inference.ask({
          state: { publicSynthetic: true },
          questions: {
            ready: { type: "noul", instructions: "Is publicSynthetic true?" },
          },
          selection: { override: id, sensitive: false },
          signal,
        });
        if (result.status === "ran") return "reachable";
        if (result.reason === "cancelled") return "cancelled";
        if (result.code === "authentication_failed")
          return "authentication_failed";
        if (result.code === "unsupported_model") return "unsupported_model";
        return "error";
      },
      signal,
    );
  }
}

export function registerRpc(bb: BbPluginApi, api: JudgeApi): void {
  async function safe<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = publicError(error);
      if (code === "invalid_input")
        throw new experimental_PluginRpcRefusal({
          code: "invalid",
          message: code,
        });
      throw new Error(code);
    }
  }
  bb.rpc.register(rpcContract, {
    "templates.list": () => safe(() => api.templates.list()),
    "templates.use": (input) =>
      safe(() => api.templates.use(input.template, input.id)),
    "sets.list": (input) => safe(() => api.sets.list(input)),
    "sets.show": (input) => safe(() => api.sets.get(input.id)),
    "sets.save": (input) => safe(() => api.sets.save(input.yaml)),
    "sets.import": (input) => safe(() => api.sets.save(input.yaml)),
    "sets.export": (input) =>
      safe(() => {
        const record = api.sets.get(input.id);
        return record ? { yaml: record.yaml } : null;
      }),
    "sets.remove": (input) => safe(() => api.sets.remove(input.id)),
    "projects.set": (input) =>
      safe(() => api.sets.project(input.projectId, input.enabled)),
    ask: (input, ctx) =>
      safe(() => api.asks.ask(input, ctx.experimental_signal)),
    run: (input, ctx) =>
      safe(() => api.runner.run(input, ctx.experimental_signal)),
    "models.list": (input) => safe(() => api.list(input)),
    "models.add": (input) => safe(() => api.models.save(input)),
    "models.default": (input) =>
      safe(() => {
        api.models.setDefault(input.id, input.private);
        return api.models.defaults();
      }),
    "models.check": (input, ctx) =>
      safe(() => api.check(input.id, input.probe, ctx.experimental_signal)),
    log: (input) => safe(() => api.log(input)),
    "runs.get": (input) => safe(() => api.repository.getRun(input.id)),
  });
}
