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
import { EvaluationService } from "./evaluation.ts";
import { TriggerService } from "./triggers.ts";
import { TriggerEngine } from "./trigger-engine.ts";
import { VerdictPublisher } from "./verdict-publisher.ts";
import { VerdictReader } from "./verdict-reader.ts";
import { CalibrationService } from "./calibration.ts";

import { displayBadges, displayThread } from "./ui.ts";

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
  readonly evaluations: EvaluationService;
  readonly calibration: CalibrationService;
  readonly triggers: TriggerService;
  readonly publisher: VerdictPublisher;
  readonly triggerEngine: TriggerEngine;
  readonly verdicts: VerdictReader;
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
    this.inference = new InferenceService(models, fetcher, repository.cache);
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
    this.evaluations = new EvaluationService(
      repository,
      this.sets,
      models,
      this.runner,
    );
    this.calibration = new CalibrationService(repository, this.sets, models);
    this.triggers = new TriggerService(repository.triggers, this.sets, models);
    this.publisher = new VerdictPublisher(
      repository,
      this.sets,
      models,
      this.calibration,
      this.triggers,
      sdk,
    );
    this.triggerEngine = new TriggerEngine(
      repository,
      this.sets,
      models,
      this.triggers,
      this.runner,
      this.publisher,
      sdk,
    );
    this.verdicts = new VerdictReader({
      repository,
      sets: this.sets,
      calibration: this.calibration,
      triggers: this.triggers,
      sdk,
      models,
    });
  }
  async dispose(): Promise<void> {
    this.verdicts.dispose();
    const stopped = this.triggerEngine.dispose();
    this.publisher.dispose();
    this.triggers.dispose();
    this.evaluations.dispose();
    this.calibration.dispose();
    this.runner.dispose();
    this.sources.dispose();
    this.inference.dispose();
    await stopped;
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
          bypassCache: true,
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
    "ui.badges": (input, ctx) =>
      safe(() => displayBadges(api, input, ctx.experimental_signal)),
    "ui.thread": (input, ctx) =>
      safe(() => displayThread(api, input.threadId, ctx.experimental_signal)),
    "projects.get": (input) =>
      safe(() => ({
        projectId: input.projectId,
        enabled: api.repository.definitions.projectEnabled(input.projectId),
      })),
    "triggers.list": (input) => safe(() => api.triggers.list(input)),
    "triggers.show": (input) => safe(() => api.triggers.get(input.id)),
    "triggers.save": (input) => safe(() => api.triggers.save(input)),
    "triggers.enable": (input) =>
      safe(() => api.triggers.enable(input.id, input.enabled)),
    "triggers.remove": (input) =>
      safe(() => {
        api.triggers.remove(input.id);
        return { removed: true as const };
      }),
    "triggers.log": (input) =>
      safe(() => api.repository.triggerAttempts.list(input)),
    "verdicts.keyed": (input, ctx) =>
      safe(() => api.verdicts.keyed(input, ctx.experimental_signal)),
    test: (input, ctx) =>
      safe(() => api.evaluations.test(input, ctx.experimental_signal)),
    "tests.get": (input) =>
      safe(() => api.repository.evaluations.getReport(input.id)),
    "calibration.accept": (input, ctx) =>
      safe(() =>
        api.calibration.accept(input.id, input.run, ctx.experimental_signal),
      ),
    "calibration.get": (input, ctx) =>
      safe(() => api.calibration.get(input.id, ctx.experimental_signal)),
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
