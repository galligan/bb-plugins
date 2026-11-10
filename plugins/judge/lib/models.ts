import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { idSchema, modelConfigSchema, type ModelConfig } from "./contracts.ts";
import {
  CONNECTION_FIELDS,
  connectionReadiness,
  defineConnectionSettings,
  runtimeConnection,
  publicConnectionIdentity,
  probeStatusSchema,
  type ModelCheck,
  type ProbeStatus,
  type ConnectionSettings,
  type ConnectionSettingsHandle,
  type ConnectionType,
} from "./connections.ts";
import { hashJson, ValidationError } from "./json.ts";
import { resolvePrivacy, type ModelSelection } from "./privacy.ts";
import type { JudgeRepository } from "./storage.ts";
import type { z } from "zod";
import type { modelIdentitySchema } from "./results.ts";

export type ModelIdentity = z.infer<typeof modelIdentitySchema>;
type Resolved = {
  ok: true;
  requestedModel: string;
  model: ModelConfig;
  identity: ModelIdentity;
  fallbackReason: "private_not_allowed" | null;
};
type Unavailable = {
  ok: false;
  reason: "not_configured" | "private_not_allowed" | "cancelled";
  code: string;
};

export async function createModelService(
  bb: BbPluginApi,
  repository: JudgeRepository,
): Promise<ModelService> {
  const settings = defineConnectionSettings(bb);
  const service = new ModelService(repository, settings, await settings.get());
  settings.onChange((next, prev) => service.settingsChanged(next, prev));
  bb.onDispose(() => service.dispose());
  return service;
}

export class ModelService {
  private repository: JudgeRepository;
  private settings: ConnectionSettingsHandle;
  private previous: ConnectionSettings;
  private revisions: Record<ConnectionType, string> = {
    typesafe: randomUUID(),
    cloudflare: randomUUID(),
    custom: randomUUID(),
  };
  private listeners = new Set<() => void>();
  private disposed = false;
  private invalidationFailed = false;
  private generation = 0;

  constructor(
    repository: JudgeRepository,
    settings: ConnectionSettingsHandle,
    initial: ConnectionSettings,
  ) {
    this.repository = repository;
    this.settings = settings;
    this.previous = initial;
    // The public settings API exposes no credential revision. Never hash keys.
    // Reload conservatively retires old cache/calibration identities.
    repository.invalidateInference();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
  onInvalidate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  configurationGeneration(): number {
    this.active();
    return this.generation;
  }
  /** Gate writes first; committed transactions must not report a notification failure. */
  mutateDefinitions<T>(write: () => T): T {
    this.active();
    const result = write();
    this.notify();
    return result;
  }
  private active(): void {
    if (this.disposed) throw new ValidationError("cancelled");
    if (this.invalidationFailed)
      throw new ValidationError("configuration_invalidation_failed");
  }
  private invalidate(): void {
    try {
      this.repository.invalidateInference();
    } catch {
      this.invalidationFailed = true;
      throw new ValidationError("configuration_invalidation_failed");
    }
    this.notify();
  }
  private notify(): void {
    this.generation++;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Generation checks still reject stale consumers if an abort hook fails. */
      }
    }
  }

  settingsChanged(next: ConnectionSettings, prev: ConnectionSettings): void {
    if (this.disposed) return;
    let changed = false;
    for (const connection of Object.keys(
      CONNECTION_FIELDS,
    ) as ConnectionType[]) {
      if (
        CONNECTION_FIELDS[connection].some((key) => next[key] !== prev[key])
      ) {
        this.revisions[connection] = randomUUID();
        changed = true;
      }
    }
    this.previous = next;
    if (changed) this.invalidate();
  }

  private async currentSettings(): Promise<ConnectionSettings> {
    this.active();
    const current = await this.settings.get();
    this.active();
    this.settingsChanged(current, this.previous);
    return current;
  }

  list(): ModelConfig[] {
    this.active();
    return this.repository.listModels();
  }
  defaults() {
    this.active();
    return this.repository.getDefaults();
  }
  save(value: unknown): ModelConfig {
    this.active();
    const model = modelConfigSchema.parse(value);
    const saved = this.repository.saveModel(model);
    this.notify();
    return saved;
  }
  remove(id: string): void {
    this.active();
    this.repository.removeModel(idSchema.parse(id));
    this.notify();
  }
  setDefault(id: string | null, privateDefault = false): void {
    this.active();
    if (id !== null) {
      const model = this.repository.getModel(idSchema.parse(id));
      if (!model) throw new ValidationError("missing_model");
      if (privateDefault && !model.allowPrivate)
        throw new ValidationError("private_model_required");
    }
    const defaults = this.repository.getDefaults();
    this.repository.setDefaults(
      privateDefault
        ? { ...defaults, privateId: id }
        : { ...defaults, defaultId: id },
    );
    this.notify();
  }

  private identity(model: ModelConfig): ModelIdentity {
    return {
      id: model.id,
      connection: model.connection,
      model: model.model,
      fingerprint: hashJson({
        configuration: model,
        endpoint: publicConnectionIdentity(model, this.previous),
        connectionRevision: this.revisions[model.connection],
      }),
    };
  }

  async readiness(id: string): Promise<ModelCheck> {
    this.active();
    const model = this.repository.getModel(idSchema.parse(id));
    if (!model)
      return {
        modelId: id,
        status: "not_configured" as const,
        code: "missing_model",
        nextAction:
          "Add an explicit Judge model; installation does not select one.",
        tested: false,
        latencyMs: null,
      };
    return {
      modelId: id,
      ...connectionReadiness(model.connection, await this.currentSettings()),
      tested: false,
      latencyMs: null,
    };
  }

  /** Explicit checks only. Saving settings and reading readiness never invoke a probe. */
  async checkModel(
    id: string,
    probe: (
      prepared: Resolved & { connection: ReturnType<typeof runtimeConnection> },
    ) => Promise<ProbeStatus>,
    signal?: AbortSignal,
  ): Promise<ModelCheck> {
    const ready = await this.readiness(id);
    if (ready.status !== "configured") return ready;
    if (signal?.aborted)
      return {
        ...ready,
        status: "cancelled",
        code: "cancelled",
        nextAction: "Probe cancelled; retry explicitly when ready.",
      };
    const start = performance.now();
    let status: ProbeStatus = "error";
    let attempted = false;
    try {
      const result = await this.usingModel(
        { override: id, sensitive: false },
        async (prepared) => {
          if (signal?.aborted) return "cancelled";
          attempted = true;
          return probe(prepared);
        },
      );
      if (!result.ok)
        return {
          modelId: id,
          status:
            result.reason === "cancelled" ? "cancelled" : "not_configured",
          code: result.code,
          nextAction: "Recheck Judge configuration before testing.",
          tested: attempted,
          latencyMs: attempted ? performance.now() - start : null,
        };
      const parsed = probeStatusSchema.safeParse(result.value);
      if (parsed.success) status = parsed.data;
    } catch {
      /* A raw upstream error must never become a model-check diagnostic. */
    }
    if (signal?.aborted) status = "cancelled";
    return {
      modelId: id,
      status,
      code: status === "reachable" ? "ok" : status,
      tested: attempted,
      latencyMs: attempted ? performance.now() - start : null,
      nextAction:
        status === "cancelled"
          ? "Probe cancelled; retry explicitly when ready."
          : status === "reachable"
            ? "Connectivity verified for this explicit test."
            : "Check the connection credentials and supported model in Judge settings.",
    };
  }

  async resolve(selection: ModelSelection): Promise<Resolved | Unavailable> {
    this.active();
    const generation = this.generation;
    const policy = resolvePrivacy(
      selection,
      this.repository.getDefaults(),
      (id) => this.repository.getModel(id),
    );
    if (!policy.ok) return policy;
    const readiness = connectionReadiness(
      policy.model.connection,
      await this.currentSettings(),
    );
    if (generation !== this.generation)
      return { ok: false, reason: "cancelled", code: "configuration_changed" };
    if (readiness.status !== "configured")
      return { ok: false, reason: "not_configured", code: readiness.code };
    return { ...policy, identity: this.identity(policy.model) };
  }

  async isCurrent(identity: ModelIdentity): Promise<boolean> {
    if (this.disposed) return false;
    await this.currentSettings();
    const model = this.repository.getModel(identity.id);
    return (
      model !== null &&
      this.identity(model).fingerprint === identity.fingerprint
    );
  }

  /** The callback is server-only and must never serialize connection material. */
  async usingModel<T>(
    selection: ModelSelection,
    operation: (
      resolved: Resolved & { connection: ReturnType<typeof runtimeConnection> },
    ) => Promise<T>,
  ): Promise<{ ok: true; value: T } | Unavailable> {
    const generation = this.generation;
    const resolved = await this.resolve(selection);
    if (!resolved.ok) return resolved;
    const settings = await this.currentSettings();
    if (
      !(await this.isCurrent(resolved.identity)) ||
      generation !== this.generation
    )
      return { ok: false, reason: "cancelled", code: "configuration_changed" };
    // No await between the final revision check and entering the operation.
    this.active();
    const currentModel = this.repository.getModel(resolved.model.id);
    if (
      !currentModel ||
      this.identity(currentModel).fingerprint !== resolved.identity.fingerprint
    )
      return { ok: false, reason: "cancelled", code: "configuration_changed" };
    const value = await operation({
      ...resolved,
      connection: runtimeConnection(resolved.model, settings),
    });
    if (
      !(await this.isCurrent(resolved.identity)) ||
      generation !== this.generation
    )
      return { ok: false, reason: "cancelled", code: "configuration_changed" };
    return { ok: true, value };
  }
}
