import assert from "node:assert/strict";
import { test } from "node:test";
import {
  harnessCoverage,
  selectedTestGlobs,
  toolingDrift,
} from "./compatibility/harness.mjs";

const full = {
  bb: { server: "./server.ts", app: "./app.tsx", host: "./host.ts" },
  scripts: {
    test: 'node --test "lib/**/*.test.ts" && vitest run',
  },
};
const vitestConfig =
  'export default { test: { include: ["tests/**/*.test.tsx"] } };';
const entries = ["server.ts", "app.tsx", "host.ts"];
const serverTest = {
  file: "lib/server.test.ts",
  text: 'import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";\nimport plugin from "../server.ts";\n',
};
const hostTest = {
  file: "lib/host-entry.test.ts",
  text: 'import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";\nimport entry from "../host.js";\n',
};
const appTest = {
  file: "tests/panel.test.tsx",
  text: 'const { loadPluginApp } = await import(\n  "@get-bb/plugin-sdk/testing/app"\n);\nloadPluginApp(() => import("../app"));\n',
};
const scanTest = {
  file: "lib/imports.test.ts",
  text: "experimental_scanPublicSdkOnly(root, { allow: [] });\n",
};
const cover = (manifest, tests, files = entries, config = vitestConfig) =>
  harnessCoverage(
    manifest,
    tests,
    [...files, ...tests.map(({ file }) => file)],
    config,
  );

test("each declared entry is covered by a selected test that imports its harness and loads it", () => {
  const { coverage, diagnostics } = cover(full, [
    serverTest,
    hostTest,
    appTest,
    scanTest,
  ]);
  assert.deepEqual(coverage, {
    server: "covered",
    host: "covered",
    app: "covered",
    importScan: "covered",
  });
  assert.deepEqual(diagnostics, []);
});

test("an entry the manifest does not declare is not applicable", () => {
  const { coverage, diagnostics } = cover(
    { ...full, bb: { server: "./server.ts" } },
    [serverTest, scanTest],
  );
  assert.equal(coverage.host, "not-applicable");
  assert.equal(coverage.app, "not-applicable");
  assert.deepEqual(diagnostics, []);
  assert.equal(cover({}, []).coverage.server, "not-applicable");
});

test("a missing harness test names the entry and the harness to use", () => {
  const { coverage, diagnostics } = cover(full, [serverTest]);
  assert.deepEqual(coverage, {
    server: "covered",
    host: "missing",
    app: "missing",
    importScan: "missing",
  });
  assert.match(diagnostics[0], /^host\.ts: .*plugin-sdk\/testing\/host/);
  assert.match(diagnostics[1], /^app\.tsx: .*plugin-sdk\/testing\/app/);
  assert.match(diagnostics[2], /experimental_scanPublicSdkOnly/);
});

test("the backend harness does not count for the frontend, and a harness import alone is not coverage", () => {
  // `/testing` must not satisfy `/testing/app` or `/testing/host`.
  assert.equal(
    cover(full, [
      { ...serverTest, text: serverTest.text + 'import "../app";\n' },
    ]).coverage.app,
    "missing",
  );
  // Imports the harness but never loads the entry file.
  assert.equal(
    cover(full, [
      {
        file: "lib/storage.test.ts",
        text: 'import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";\n',
      },
    ]).coverage.server,
    "missing",
  );
  // Fixtures and source files are not tests.
  assert.equal(
    cover(full, [{ ...serverTest, file: "lib/fixture.ts" }]).coverage.server,
    "missing",
  );
});

test("only an import that resolves to the declared entry file counts", () => {
  const loading = (specifier, file = "tests/panel.test.tsx") => ({
    file,
    text: `import "@get-bb/plugin-sdk/testing/app";\nimport(${JSON.stringify(specifier)});\n`,
  });
  const app = (test, files) => cover(full, [test], files).coverage.app;
  // Exact path, extensionless, and the `.js` spelling of a TypeScript entry.
  for (const specifier of ["../app.tsx", "../app", "../app.js", "../app.jsx"])
    assert.equal(app(loading(specifier)), "covered", specifier);
  // A different file with the same basename, by directory or by extension.
  assert.equal(app(loading("./app.tsx")), "missing");
  assert.equal(app(loading("../components/app.tsx")), "missing");
  assert.equal(app(loading("../app.ts")), "missing");
  // An extensionless import is ambiguous when another file shares the stem.
  assert.equal(app(loading("../app"), [...entries, "app.ts"]), "missing");
  // It names another real file outright.
  assert.equal(app(loading("../app.js"), [...entries, "app.js"]), "missing");
  // A bare package specifier is never the entry.
  assert.equal(app(loading("app")), "missing");
});

test("a harness test the package's test script does not run is reported as unselected", () => {
  const stray = { ...appTest, file: "components/panel.test.tsx" };
  const { coverage, diagnostics } = cover(full, [
    serverTest,
    hostTest,
    stray,
    { ...scanTest, file: "scripts/imports.test.ts" },
  ]);
  assert.equal(coverage.app, "unselected");
  assert.equal(coverage.importScan, "unselected");
  assert.match(
    diagnostics[0],
    /^app\.tsx: components\/panel\.test\.tsx loads it .* does not run that file/,
  );
  assert.match(diagnostics[1], /^import scan: scripts\/imports\.test\.ts/);
  // A selected test wins over an unselected one for the same entry.
  assert.equal(cover(full, [stray, appTest]).coverage.app, "covered");
  // No test script selects nothing.
  assert.equal(
    cover({ bb: full.bb }, [serverTest]).coverage.server,
    "unselected",
  );
});

test("reads the globs a test script selects from the repository's command forms", () => {
  assert.deepEqual(
    selectedTestGlobs(
      'node --test "lib/**/*.test.ts" && node --import tsx --test "components/**/*.test.tsx"',
    ),
    ["lib/**/*.test.ts", "components/**/*.test.tsx"],
  );
  assert.deepEqual(selectedTestGlobs("vitest run", vitestConfig), [
    "tests/**/*.test.tsx",
  ]);
  // Without a config, or without literal includes, Vitest's default applies.
  assert.deepEqual(selectedTestGlobs("vitest run"), [
    "**/*.{test,spec}.?(c|m)[jt]s?(x)",
  ]);
  assert.deepEqual(selectedTestGlobs(undefined), []);
});

test("names shared test tooling pinned to more than one version", () => {
  const packages = [
    {
      directory: "plugins/a",
      manifest: { devDependencies: { vitest: "5.1.0" } },
    },
    {
      directory: "plugins/b",
      manifest: { devDependencies: { vitest: "5.1.0" } },
    },
    {
      directory: "plugins/c",
      manifest: {
        dependencies: { vitest: "4.1.12" },
        devDependencies: { zod: "1" },
      },
    },
    { directory: "plugins/none", manifest: {} },
  ];
  assert.deepEqual(toolingDrift(packages), [
    "vitest: 5.1.0 (plugins/a devDependencies, plugins/b devDependencies); 4.1.12 (plugins/c dependencies). Pin one version in every package.",
  ]);
  assert.deepEqual(toolingDrift(packages.slice(0, 2)), []);
});

test("a package that pins a tool differently in its two sections is drift", () => {
  assert.deepEqual(
    toolingDrift([
      {
        directory: "plugins/a",
        manifest: {
          dependencies: { react: "19.3.1" },
          devDependencies: { react: "18.3.1" },
        },
      },
      {
        directory: "plugins/b",
        manifest: { dependencies: { react: "19.3.1" } },
      },
    ]),
    [
      "react: 19.3.1 (plugins/a dependencies, plugins/b dependencies); 18.3.1 (plugins/a devDependencies). Pin one version in every package.",
    ],
  );
});
