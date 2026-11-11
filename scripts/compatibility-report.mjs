import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Glob, semver } from "bun";
import { getFileInfo } from "prettier";
import { gates, gateCoverage } from "./compatibility/coverage.mjs";
import { harnessCoverage, toolingDrift } from "./compatibility/harness.mjs";

const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;
const rangePart =
  /^(?:\^|~|>=|<=|>|<|=)?\d+(?:\.\d+){0,2}(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function dependency(manifest, name, diagnostics) {
  const declarations = ["dependencies", "devDependencies"]
    .filter((section) => manifest[section]?.[name] !== undefined)
    .map((section) => ({ section, specifier: manifest[section][name] }));
  if (!declarations.length)
    diagnostics.push(
      `${name}: missing direct pin; declare the build dependency explicitly.`,
    );
  for (const { specifier } of declarations) {
    if (!exactVersion.test(specifier))
      diagnostics.push(
        `${name}: ${specifier} is not an exact pin; record the resolved version with upgrade evidence.`,
      );
  }
  if (new Set(declarations.map(({ specifier }) => specifier)).size > 1) {
    diagnostics.push(
      `${name}: dependency sections disagree; reconcile declarations.`,
    );
  }
  return declarations;
}

function compare(declared, pins, label, diagnostics) {
  if (!declared) {
    diagnostics.push(
      `${label}: missing engine declaration; document supported compatibility.`,
    );
    return "unknown";
  }
  // Bun accepts some malformed ranges as wildcards. Bound comparisons to the
  // numeric range forms we can validate; never report unsupported syntax as OK.
  const parts =
    typeof declared === "string" ? declared.split(/\s*\|\|\s*|\s+/) : [];
  if (!parts.length || parts.some((part) => !rangePart.test(part))) {
    diagnostics.push(
      `${label}: range ${declared} needs manual comparison (unsupported syntax).`,
    );
    return "unknown";
  }
  if (
    !pins.length ||
    pins.some(({ specifier }) => !exactVersion.test(specifier))
  )
    return "unknown";
  if (pins.some(({ specifier }) => !semver.satisfies(specifier, declared))) {
    diagnostics.push(
      `${label}: direct pin does not satisfy declared range ${declared}; review the pin or compatibility declaration.`,
    );
    return "mismatch";
  }
  return "satisfies-declaration";
}

export function describePlugin(
  manifest,
  directory,
  configuration,
  formatSelection,
) {
  const diagnostics = [];
  if (!manifest.name || !manifest.version)
    diagnostics.push(
      "Missing package name/version; complete package metadata.",
    );
  const sdk = dependency(manifest, "@get-bb/plugin-sdk", diagnostics);
  const buildTool = dependency(manifest, "bb-app", diagnostics);
  const declared = {
    bb: manifest.engines?.bb ?? null,
    sdk: manifest.engines?.bbPluginSdk ?? null,
  };
  const comparison = {
    bb: compare(declared.bb, buildTool, "BB", diagnostics),
    sdk: compare(declared.sdk, sdk, "SDK", diagnostics),
  };
  const workspace = configuration.workspaces.some((pattern) =>
    new Glob(pattern).match(directory),
  );
  const coverage = Object.fromEntries(
    gates.map((gate) => [
      gate,
      gateCoverage(
        gate,
        configuration.scripts[gate],
        manifest,
        directory,
        workspace,
        formatSelection,
      ),
    ]),
  );
  for (const [gate, { status, reason }] of Object.entries(coverage)) {
    if (status !== "included")
      diagnostics.push(
        `${gate}: ${status}. ${reason} Run package checks separately or review root selection.`,
      );
  }
  return {
    directory,
    name: manifest.name ?? null,
    version: manifest.version ?? null,
    declared,
    pins: { sdk, buildTool },
    comparison,
    coverage,
    diagnostics,
  };
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", "dist"].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : entry.isFile()
        ? [file]
        : [];
  });
}

export async function buildReport(root) {
  const manifest = readJson(path.join(root, "package.json"));
  if (
    !Array.isArray(manifest.workspaces) ||
    !manifest.workspaces.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Expected an array of workspace patterns in package.json.");
  }
  const configuration = {
    workspaces: manifest.workspaces,
    scripts: manifest.scripts ?? {},
  };
  const plugins = [];
  const manifests = [];
  for (const entry of readdirSync(path.join(root, "plugins"), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.isDirectory()) continue;
    const directory = `plugins/${entry.name}`;
    const file = path.join(root, directory, "package.json");
    if (!existsSync(file))
      throw new Error(
        `${directory}: missing package.json; cannot report plugin compatibility.`,
      );
    const selection = { selected: 0, ignored: 0 };
    const tests = [];
    for (const source of sourceFiles(path.join(root, directory))) {
      if (/\.test\.[cm]?[jt]sx?$/.test(source))
        tests.push({
          file: path.relative(path.join(root, directory), source),
          text: readFileSync(source, "utf8"),
        });
      const info = await getFileInfo(source, {
        ignorePath: path.join(root, ".prettierignore"),
        withNodeModules: false,
      });
      if (info.ignored) selection.ignored++;
      else if (info.inferredParser) selection.selected++;
    }
    const pluginManifest = readJson(file);
    manifests.push({ directory, manifest: pluginManifest });
    const described = describePlugin(
      pluginManifest,
      directory,
      configuration,
      selection,
    );
    const harness = harnessCoverage(pluginManifest, tests);
    plugins.push({
      ...described,
      harness: harness.coverage,
      diagnostics: [...described.diagnostics, ...harness.diagnostics],
    });
  }
  return {
    schemaVersion: 1,
    policy: {
      packageManager: manifest.packageManager ?? null,
      node: existsSync(path.join(root, ".node-version"))
        ? readFileSync(path.join(root, ".node-version"), "utf8").trim()
        : null,
    },
    gateCommands: Object.fromEntries(
      gates.map((gate) => [gate, configuration.scripts[gate] ?? null]),
    ),
    testedCompatibility: {
      status: "not-established",
      reason:
        "This read-only report runs no gates or BB runtime tests. Pins, policy, and gate selection are not execution evidence; attach exact runtime versions and results to the upgrade PR.",
    },
    toolingDrift: toolingDrift(manifests),
    plugins,
  };
}

export function renderReport(report) {
  const lines = [
    "Plugin compatibility and root gate selection",
    `Policy: ${report.policy.packageManager ?? "Bun unspecified"}; Node ${report.policy.node ?? "unspecified in .node-version"}`,
    `Tested compatibility: ${report.testedCompatibility.status}. ${report.testedCompatibility.reason}`,
  ];
  lines.push(...report.toolingDrift.map((drift) => `! ${drift}`));
  const pins = (entries) =>
    entries
      .map(({ specifier, section }) => `${specifier} (${section})`)
      .join(", ") || "missing";
  for (const plugin of report.plugins) {
    lines.push(
      "",
      `${plugin.name ?? plugin.directory}@${plugin.version ?? "unknown"}`,
      `  Declared: BB ${plugin.declared.bb ?? "missing"}; SDK ${plugin.declared.sdk ?? "missing"}`,
      `  Direct pins: SDK ${pins(plugin.pins.sdk)}; bb-app ${pins(plugin.pins.buildTool)}`,
      `  Gates: ${Object.entries(plugin.coverage)
        .map(([gate, { status }]) => `${gate}=${status}`)
        .join(", ")}`,
      `  Harness: ${Object.entries(plugin.harness)
        .map(([kind, status]) => `${kind}=${status}`)
        .join(", ")}`,
    );
    lines.push(...plugin.diagnostics.map((diagnostic) => `  ! ${diagnostic}`));
  }
  return lines.join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--json"))
      throw new Error("Usage: bun scripts/compatibility-report.mjs [--json]");
    const report = await buildReport(path.resolve(import.meta.dirname, ".."));
    console.log(
      args[0] === "--json"
        ? JSON.stringify(report, null, 2)
        : renderReport(report),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
