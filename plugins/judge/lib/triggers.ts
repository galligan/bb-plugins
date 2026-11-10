import {
  triggerPageSchema,
  parseTrigger,
  type TriggerDefinition,
  type TriggerRecord,
} from "./triggers-contract.ts";
import type { TriggerRepository } from "./triggers-storage.ts";
import type { SetService } from "./sets.ts";
import type { ModelService } from "./models.ts";
import { idSchema } from "./contracts.ts";
import { ValidationError } from "./json.ts";

/** Configuration alone is inert; enable is explicit and never grants private-data permission. */
export class TriggerService {
  private repository: TriggerRepository;
  private sets: SetService;
  private models: ModelService;
  private disposed = false;
  private listeners = new Set<(id: string) => void>();
  constructor(
    repository: TriggerRepository,
    sets: SetService,
    models: ModelService,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.models = models;
  }
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
  private active(): void {
    if (this.disposed) throw new ValidationError("cancelled");
    this.models.configurationGeneration();
  }
  onChange(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(id: string): void {
    for (const listener of this.listeners)
      try {
        listener(id);
      } catch {
        /* A committed mutation remains successful; consumers must also compare stored revisions. */
      }
  }
  private validate(definition: TriggerDefinition): void {
    const set = this.sets.get(definition.setId);
    if (!set) throw new ValidationError("missing_set");
    if (
      Object.keys(definition.badges).some(
        (id) => !Object.hasOwn(set.definition.outcomes, id),
      )
    )
      throw new ValidationError("unknown_badge_outcome");
  }
  list(value: unknown) {
    this.active();
    const input = triggerPageSchema.parse(value);
    const rows = this.repository.page(input.limit + 1, input.after);
    const triggers = rows.slice(0, input.limit);
    return {
      triggers,
      next: rows.length > input.limit ? triggers.at(-1)!.definition.id : null,
    };
  }
  get(id: string): TriggerRecord | null {
    this.active();
    return this.repository.get(idSchema.parse(id));
  }
  save(value: unknown): TriggerRecord {
    this.active();
    const definition = parseTrigger(value);
    this.validate(definition);
    const saved = this.repository.save(definition);
    this.changed(saved.definition.id);
    return saved;
  }
  enable(id: string, enabled: boolean): TriggerRecord {
    this.active();
    idSchema.parse(id);
    if (typeof enabled !== "boolean")
      throw new ValidationError("invalid_enabled");
    const previous = this.repository.get(id);
    if (!previous) throw new ValidationError("missing_trigger");
    if (enabled) this.validate(previous.definition);
    const saved = this.repository.setEnabled(id, enabled);
    this.changed(id);
    return saved;
  }
  remove(id: string): void {
    this.active();
    idSchema.parse(id);
    this.repository.remove(id);
    this.changed(id);
  }
}
