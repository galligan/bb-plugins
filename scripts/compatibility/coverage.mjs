import { Glob } from "bun";

export const gates = ["format:check", "lint", "check", "test", "build"];
const result = (status, reason) => ({ status, reason });

// Deliberately recognize only the repository's command forms. Shell wrappers or
// new flags require a reviewed adapter, not an optimistic coverage assertion.
export function gateCoverage(
  gate,
  command,
  manifest,
  directory,
  workspace,
  formatSelection,
) {
  if (!command) return result("unknown", "Root gate script is missing.");
  if (gate === "format:check") {
    if (command !== "prettier . --check")
      return result("unknown", "Unrecognized formatter command.");
    return result(
      formatSelection.selected ? "included" : "excluded",
      `Prettier source selection: ${formatSelection.selected} supported files, ${formatSelection.ignored} ignored files (generated output omitted).`,
    );
  }
  if (gate === "lint") {
    const match =
      /^oxlint plugins scripts(?: --ignore-pattern '([^']+)')? --deny-warnings$/.exec(
        command,
      );
    if (!match) return result("unknown", "Unrecognized lint command.");
    if (match[1] && !match[1].endsWith("/**"))
      return result(
        "unknown",
        "Lint ignore pattern is not a whole-directory exclusion.",
      );
    const excluded =
      match[1] && new Glob(match[1].slice(0, -3)).match(directory);
    return result(
      excluded ? "excluded" : "included",
      "Oxlint package selection; only supported source files are linted.",
    );
  }
  const match =
    /^bun --filter '([^']+)' (check|test|build)( && bun test \.\/scripts\/\*\.test\.mjs)?$/.exec(
      command,
    );
  if (!match || match[2] !== gate || (match[3] && gate !== "test")) {
    return result("unknown", "Unrecognized workspace gate command.");
  }
  if (!workspace)
    return result("excluded", "Directory is not selected by root workspaces.");
  if (!manifest.name)
    return result(
      "unknown",
      "Package name is missing; cannot evaluate workspace filter.",
    );
  const filter = match[1];
  const selected = filter.startsWith("!")
    ? !new Glob(filter.slice(1)).match(manifest.name)
    : new Glob(filter).match(manifest.name);
  if (!selected)
    return result("excluded", `Root filter ${filter} excludes this package.`);
  if (!manifest.scripts?.[gate])
    return result("not-configured", `Package has no ${gate} script.`);
  return result("included", `Package script: ${manifest.scripts[gate]}`);
}
