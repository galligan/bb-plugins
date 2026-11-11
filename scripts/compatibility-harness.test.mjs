import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessCoverage, toolingDrift } from "./compatibility/harness.mjs";

const full = {
  bb: { server: "./server.ts", app: "./app.tsx", host: "./host.ts" },
};
const serverTest = {
  file: "lib/server.test.ts",
  text: 'import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";\nimport plugin from "../server.ts";\n',
};
const hostTest = {
  file: "lib/host-entry.test.ts",
  text: 'import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";\nimport entry from "../host.ts";\n',
};
const appTest = {
  file: "tests/panel.test.tsx",
  text: 'const { loadPluginApp } = await import(\n  "@get-bb/plugin-sdk/testing/app"\n);\nloadPluginApp(() => import("../app"));\n',
};
const scanTest = {
  file: "lib/imports.test.ts",
  text: "experimental_scanPublicSdkOnly(root, { allow: [] });\n",
};

test("each declared entry is covered by a test that imports its harness and loads it", () => {
  const { coverage, diagnostics } = harnessCoverage(full, [
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
  const { coverage, diagnostics } = harnessCoverage(
    { bb: { server: "./server.ts" } },
    [serverTest, scanTest],
  );
  assert.equal(coverage.host, "not-applicable");
  assert.equal(coverage.app, "not-applicable");
  assert.deepEqual(diagnostics, []);
  assert.equal(harnessCoverage({}, []).coverage.server, "not-applicable");
});

test("a missing harness test names the entry and the harness to use", () => {
  const { coverage, diagnostics } = harnessCoverage(full, [serverTest]);
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
    harnessCoverage(full, [
      { ...serverTest, text: serverTest.text + 'import "../app";\n' },
    ]).coverage.app,
    "missing",
  );
  // Imports the harness but never loads the entry file.
  assert.equal(
    harnessCoverage(full, [
      {
        file: "lib/storage.test.ts",
        text: 'import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";\n',
      },
    ]).coverage.server,
    "missing",
  );
  // Fixtures and source files are not tests.
  assert.equal(
    harnessCoverage(full, [{ ...serverTest, file: "lib/fixture.ts" }]).coverage
      .server,
    "missing",
  );
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
    "vitest: 5.1.0 (plugins/a, plugins/b); 4.1.12 (plugins/c). Pin one version in every package.",
  ]);
  assert.deepEqual(toolingDrift(packages.slice(0, 2)), []);
});
