import { idSchema } from "./contracts.ts";
import type { ModelService } from "./models.ts";
import { readSetYaml } from "./sets-yaml.ts";
import type { QuestionSet } from "./sets-schema.ts";
import { type JudgeRepository, PersistenceError } from "./storage.ts";
import { ValidationError } from "./json.ts";
import { setListSchema } from "./sets-contract.ts";

export class SetService {
  private repository: JudgeRepository;
  private models: ModelService;
  constructor(repository: JudgeRepository, models: ModelService) {
    this.repository = repository;
    this.models = models;
  }
  save(yaml: string) {
    const parsed = readSetYaml(yaml);
    return this.models.mutateDefinitions(() => {
      this.repository.definitions.saveSet({
        id: parsed.definition.id,
        schemaVersion: 1,
        scope: "global",
        hash: parsed.hash,
        yaml: parsed.yaml,
      });
      return { ...parsed, scope: "global" as const };
    });
  }
  get(id: string) {
    const record = this.repository.definitions.getSet(idSchema.parse(id));
    if (!record) return null;
    try {
      const parsed = readSetYaml(record.yaml);
      if (
        record.schemaVersion !== 1 ||
        record.scope !== "global" ||
        record.id !== parsed.definition.id ||
        record.hash !== parsed.hash
      )
        throw new PersistenceError();
      return { ...parsed, scope: "global" as const };
    } catch {
      throw new PersistenceError();
    }
  }
  remove(id: string) {
    idSchema.parse(id);
    return this.models.mutateDefinitions(() => {
      this.repository.definitions.removeSet(id);
      return { removed: true as const };
    });
  }
  applicable(set: QuestionSet, projectId?: string): boolean {
    if (projectId === undefined) return set.projects === "all";
    idSchema.parse(projectId);
    return (
      this.repository.definitions.projectEnabled(projectId) &&
      (set.projects === "all" || set.projects.includes(projectId))
    );
  }
  project(id: string, enabled: boolean) {
    idSchema.parse(id);
    return this.models.mutateDefinitions(() => {
      this.repository.definitions.setProjectEnabled(id, enabled);
      return { projectId: id, enabled };
    });
  }
  list(value: unknown) {
    const input = setListSchema.parse(value);
    if (input.projectId !== undefined) idSchema.parse(input.projectId);
    const rows = this.repository.definitions.pageSets(
      input.limit + 1,
      input.after,
    );
    const sets = rows.slice(0, input.limit).map((row) => {
      const parsed = this.get(row.id);
      if (!parsed) throw new ValidationError("missing_set");
      return {
        id: parsed.definition.id,
        description: parsed.definition.description,
        hash: parsed.hash,
        projects: parsed.definition.projects,
        applicable: this.applicable(parsed.definition, input.projectId),
      };
    });
    return { sets, next: rows.length > input.limit ? sets.at(-1)!.id : null };
  }
}
