import path from "node:path";

// Each manifest entry and the public SDK harness that loads it in-process.
export const harnesses = {
  server: "@get-bb/plugin-sdk/testing",
  host: "@get-bb/plugin-sdk/testing/host",
  app: "@get-bb/plugin-sdk/testing/app",
};

const quoted = (text) =>
  new RegExp(`["']${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`);

/**
 * Report, from source text alone, whether each entry a manifest declares has a
 * test that imports the matching harness and references that entry file, and
 * whether any test runs the public-SDK import scan.
 *
 * `sources` are `{ file, text }` with package-relative paths. This is a static
 * signal: it does not run tests or judge what they assert.
 */
export function harnessCoverage(manifest, sources) {
  const tests = sources.filter(({ file }) =>
    /\.test\.[cm]?[jt]sx?$/.test(file),
  );
  const diagnostics = [];
  const coverage = {};
  for (const [kind, harness] of Object.entries(harnesses)) {
    const entry = manifest.bb?.[kind];
    if (typeof entry !== "string") {
      coverage[kind] = "not-applicable";
      continue;
    }
    const stem = path.basename(entry).replace(/\.[cm]?[jt]sx?$/, "");
    const loads = new RegExp(`/${stem}(?:\\.[cm]?[jt]sx?)?["']`);
    const covered = tests.some(
      ({ text }) => quoted(harness).test(text) && loads.test(text),
    );
    coverage[kind] = covered ? "covered" : "missing";
    if (!covered)
      diagnostics.push(
        `${path.basename(entry)}: no test imports ${harness} and loads this entry; add a harness test before checking it live.`,
      );
  }
  coverage.importScan = tests.some(({ text }) =>
    text.includes("experimental_scanPublicSdkOnly("),
  )
    ? "covered"
    : "missing";
  if (coverage.importScan === "missing")
    diagnostics.push(
      "import scan: no test calls experimental_scanPublicSdkOnly; add one package test.",
    );
  return { coverage, diagnostics };
}

/** Test tooling that every package should pin to the same version. */
export const sharedTooling = [
  "better-sqlite3",
  "react",
  "react-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "jsdom",
  "vitest",
];

/** Name each shared tool that packages pin to more than one specifier. */
export function toolingDrift(packages) {
  const diagnostics = [];
  for (const tool of sharedTooling) {
    const users = new Map();
    for (const { directory, manifest } of packages) {
      const specifier =
        manifest.dependencies?.[tool] ?? manifest.devDependencies?.[tool];
      if (specifier === undefined) continue;
      users.set(specifier, [...(users.get(specifier) ?? []), directory]);
    }
    if (users.size > 1)
      diagnostics.push(
        `${tool}: ${[...users]
          .map(
            ([specifier, directories]) =>
              `${specifier} (${directories.join(", ")})`,
          )
          .join("; ")}. Pin one version in every package.`,
      );
  }
  return diagnostics;
}
