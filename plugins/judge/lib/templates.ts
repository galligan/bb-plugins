import { idSchema } from "./contracts.ts";
import { ValidationError } from "./json.ts";
import { readSetYaml } from "./sets-yaml.ts";
import type { SetService } from "./sets.ts";
import { needsAttention } from "./templates/needs-attention.ts";
import { completionCheck } from "./templates/completion-check.ts";
import { diffLint } from "./templates/diff-lint.ts";

const version = "1.0.0";
const catalog = [needsAttention, completionCheck, diffLint];
export class TemplateService {
  private sets: SetService;
  constructor(sets: SetService) {
    this.sets = sets;
  }
  list() {
    return catalog.map((raw) => {
      const { definition } = readSetYaml(JSON.stringify(raw));
      return {
        id: definition.id,
        version,
        description: definition.description,
        caseCount: definition.cases.length,
      };
    });
  }
  use(template: string, id: string) {
    idSchema.parse(template);
    idSchema.parse(id);
    const raw = catalog.find((item) => item.id === template);
    if (!raw) throw new ValidationError("missing_template");
    // Copy is creation, never an implicit replacement of the user's edited set.
    if (this.sets.get(id)) throw new ValidationError("set_exists");
    return this.sets.save(
      JSON.stringify({ ...raw, id, origin: `${template}@${version}` }),
    );
  }
}
