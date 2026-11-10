import {
  isAlias,
  isPair,
  isScalar,
  parseDocument,
  stringify,
  visit,
} from "yaml";
import { hashJson, LIMITS, ValidationError } from "./json.ts";
import { parseSet } from "./sets-schema.ts";

export function readSetYaml(yaml: string) {
  try {
    if (Buffer.byteLength(yaml, "utf8") > LIMITS.definitionBytes)
      throw new ValidationError("definition_bytes");
    const document = parseDocument(yaml, {
      uniqueKeys: true,
      strict: true,
      version: "1.2",
      schema: "core",
    });
    if (document.errors.length || document.warnings.length)
      throw new ValidationError("invalid_yaml");
    visit(document, (_key, node, path) => {
      if (path.length > 128 || isAlias(node))
        throw new ValidationError("invalid_yaml_structure");
      if (node && typeof node === "object" && "anchor" in node && node.anchor)
        throw new ValidationError("yaml_anchor");
      if (
        node &&
        typeof node === "object" &&
        "tag" in node &&
        typeof node.tag === "string" &&
        !node.tag.startsWith("tag:yaml.org,2002:")
      )
        throw new ValidationError("yaml_tag");
      if (
        isPair(node) &&
        (!isScalar(node.key) || typeof node.key.value !== "string")
      )
        throw new ValidationError("yaml_key");
    });
    const definition = parseSet(document.toJS({ maxAliasCount: 0 }));
    const exported = stringify(definition, {
      lineWidth: 0,
      aliasDuplicateObjects: false,
    });
    if (Buffer.byteLength(exported, "utf8") > LIMITS.definitionBytes)
      throw new ValidationError("definition_bytes");
    return { definition, hash: hashJson(definition), yaml: exported };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // YAML diagnostics contain source excerpts; never expose them through RPC/CLI errors.
    throw new ValidationError("invalid_definition");
  }
}
