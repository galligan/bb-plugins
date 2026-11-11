import path from "node:path";
import { Glob } from "bun";

// Each manifest entry and the public SDK harness that loads it in-process.
export const harnesses = {
  server: "@get-bb/plugin-sdk/testing",
  host: "@get-bb/plugin-sdk/testing/host",
  app: "@get-bb/plugin-sdk/testing/app",
};

const isTest = (file) => /\.test\.[cm]?[jt]sx?$/.test(file);
const sourceExtension = /\.[cm]?[jt]sx?$/;
const extensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const quoted = (text) =>
  new RegExp(`["']${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`);

/** Module specifiers in static, side-effect, and dynamic imports. */
function specifiers(text) {
  return [
    ...text.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...text.matchAll(/\bimport\s*\(?\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

// A test loads an entry when a relative import resolves to exactly that file.
// An extensionless or `.js`-style specifier counts only when it does not name
// another real file and no other file shares the entry's stem.
function loadsEntry(test, entry, files) {
  const stem = entry.replace(sourceExtension, "");
  const competing = extensions.some(
    (extension) => stem + extension !== entry && files.has(stem + extension),
  );
  return specifiers(test.text).some((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(test.file), specifier),
    );
    if (resolved === entry) return true;
    if (files.has(resolved) || competing) return false;
    return resolved.replace(/\.[cm]?jsx?$/, "") === stem;
  });
}

/**
 * The globs a package's `test` script selects. Recognizes the repository's
 * forms only: quoted `node --test` globs, and `vitest run` with literal
 * `include` globs in `vitest.config.ts` (Vitest's default without one).
 */
export function selectedTestGlobs(script, vitestConfig) {
  if (typeof script !== "string") return [];
  const globs = [...script.matchAll(/"([^"]*\*[^"]*)"/g)].map(
    (match) => match[1],
  );
  if (/\bvitest run\b/.test(script)) {
    const include = /\binclude\s*:\s*\[([^\]]*)\]/.exec(vitestConfig ?? "");
    globs.push(
      ...(include
        ? [...include[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
        : ["**/*.{test,spec}.?(c|m)[jt]s?(x)"]),
    );
  }
  return globs;
}

/**
 * Report, from source text alone, whether each entry a manifest declares has a
 * test that the package's test script runs, that imports the matching harness,
 * and that loads that exact entry file; and whether a selected test runs the
 * public-SDK import scan.
 *
 * `sources` are `{ file, text }` for test files and `files` is every source
 * path, both package-relative with `/` separators. This is a static signal: it
 * does not run tests or judge what they assert.
 */
export function harnessCoverage(manifest, sources, files, vitestConfig) {
  const globs = selectedTestGlobs(manifest.scripts?.test, vitestConfig).map(
    (glob) => new Glob(glob),
  );
  const tests = sources.filter(({ file }) => isTest(file));
  const selected = (test) => globs.some((glob) => glob.match(test.file));
  const status = (matching) =>
    matching.some(selected)
      ? "covered"
      : matching.length > 0
        ? "unselected"
        : "missing";
  const known = new Set(files);
  const diagnostics = [];
  const coverage = {};
  for (const [kind, harness] of Object.entries(harnesses)) {
    const declared = manifest.bb?.[kind];
    if (typeof declared !== "string") {
      coverage[kind] = "not-applicable";
      continue;
    }
    const entry = path.posix.normalize(declared);
    const matching = tests.filter(
      (test) =>
        quoted(harness).test(test.text) && loadsEntry(test, entry, known),
    );
    coverage[kind] = status(matching);
    if (coverage[kind] === "missing")
      diagnostics.push(
        `${entry}: no test imports ${harness} and loads this entry; add a harness test before checking it live.`,
      );
    if (coverage[kind] === "unselected")
      diagnostics.push(
        `${entry}: ${matching.map(({ file }) => file).join(", ")} loads it under ${harness}, but the package's test script does not run that file.`,
      );
  }
  const scans = tests.filter(({ text }) =>
    text.includes("experimental_scanPublicSdkOnly("),
  );
  coverage.importScan = status(scans);
  if (coverage.importScan === "missing")
    diagnostics.push(
      "import scan: no test calls experimental_scanPublicSdkOnly; add one package test.",
    );
  if (coverage.importScan === "unselected")
    diagnostics.push(
      `import scan: ${scans.map(({ file }) => file).join(", ")} calls experimental_scanPublicSdkOnly, but the package's test script does not run that file.`,
    );
  return { coverage, diagnostics };
}

/** Tooling that every package should pin to the same version. */
export const sharedTooling = [
  "typescript",
  "better-sqlite3",
  "react",
  "react-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "jsdom",
  "vitest",
];

/**
 * Name each shared tool that is pinned to more than one specifier, across
 * packages or across one package's two dependency sections.
 */
export function toolingDrift(packages) {
  const diagnostics = [];
  for (const tool of sharedTooling) {
    const users = new Map();
    for (const { directory, manifest } of packages) {
      for (const section of ["dependencies", "devDependencies"]) {
        const specifier = manifest[section]?.[tool];
        if (specifier === undefined) continue;
        users.set(specifier, [
          ...(users.get(specifier) ?? []),
          `${directory} ${section}`,
        ]);
      }
    }
    if (users.size > 1)
      diagnostics.push(
        `${tool}: ${[...users]
          .map(([specifier, where]) => `${specifier} (${where.join(", ")})`)
          .join("; ")}. Pin one version in every package.`,
      );
  }
  return diagnostics;
}
