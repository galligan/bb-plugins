import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReport,
  describePlugin,
  renderReport,
} from "./compatibility-report.mjs";
import {
  configuration,
  oldPlugin,
  runtimeDependency,
  excludedPlugin,
} from "./compatibility/fixtures.mjs";

const describe = (manifest, config = configuration) =>
  describePlugin(
    manifest,
    `plugins/${manifest.name?.replace("bb-plugin-", "") ?? "missing"}`,
    config,
    { selected: 1, ignored: 0 },
  );

test("old SDK pins are valid declarations, not tested runtime compatibility", () => {
  const report = describe(oldPlugin);
  assert.equal(report.comparison.sdk, "satisfies-declaration");
  assert.equal(report.comparison.bb, "satisfies-declaration");
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.pins.sdk[0].section, "devDependencies");
});

test("SDK pins in dependencies are recognized and conflicting declarations diagnosed", () => {
  assert.equal(describe(runtimeDependency).pins.sdk[0].section, "dependencies");
  const conflict = describe({
    ...runtimeDependency,
    devDependencies: {
      ...runtimeDependency.devDependencies,
      "@get-bb/plugin-sdk": "0.4.87",
    },
  });
  assert.equal(conflict.comparison.sdk, "mismatch");
  assert.ok(
    conflict.diagnostics.some((message) =>
      message.includes("sections disagree"),
    ),
  );
});

test("missing metadata and ranged pins remain unknown with actionable diagnostics", () => {
  const missing = describe({});
  assert.equal(missing.name, null);
  assert.equal(missing.comparison.sdk, "unknown");
  assert.ok(
    missing.diagnostics.some((message) =>
      message.includes("missing direct pin"),
    ),
  );
  const ranged = describe({
    ...oldPlugin,
    devDependencies: {
      ...oldPlugin.devDependencies,
      "@get-bb/plugin-sdk": "^0.4.1",
    },
  });
  assert.equal(ranged.comparison.sdk, "unknown");
  assert.ok(
    ranged.diagnostics.some((message) => message.includes("not an exact pin")),
  );
  const invalid = describe({
    ...oldPlugin,
    engines: { ...oldPlugin.engines, bbPluginSdk: "bad" },
  });
  assert.equal(invalid.comparison.sdk, "unknown");
});

test("root filters and package scripts determine selection rather than plugin identity", () => {
  const excluded = describe(excludedPlugin);
  for (const gate of ["check", "test", "build", "lint"])
    assert.equal(excluded.coverage[gate].status, "excluded");
  const included = describe(excludedPlugin, {
    ...configuration,
    scripts: {
      ...configuration.scripts,
      test: "bun --filter 'bb-plugin-*' test",
    },
  });
  assert.equal(included.coverage.test.status, "included");
  assert.equal(
    describe({ ...oldPlugin, scripts: {} }).coverage.test.status,
    "not-configured",
  );
  assert.equal(
    describe(oldPlugin, { ...configuration, workspaces: ["other/*"] }).coverage
      .test.status,
    "excluded",
  );
});

test("unsupported commands fail closed as unknown instead of asserting coverage", () => {
  const report = describe(oldPlugin, {
    ...configuration,
    scripts: {
      test: "bun run custom-tests",
      check: "bun --filter '*' check || true",
      lint: "oxlint plugins scripts --ignore-pattern '**/*.ts' --deny-warnings",
    },
  });
  for (const gate of ["test", "check", "build", "lint", "format:check"])
    assert.equal(report.coverage[gate].status, "unknown");
});

test("report reads actual manifests, ignore rules and policy without writes or execution claims", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "compatibility-report-"));
  try {
    const put = (file, contents) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    };
    put(
      "package.json",
      JSON.stringify({ ...configuration, packageManager: "bun@1.3.14" }),
    );
    put(".node-version", "24\n");
    put(".prettierignore", "plugins/excluded/\nplugins/old/package.json\n");
    put("plugins/excluded/package.json", JSON.stringify(excludedPlugin));
    put("plugins/old/package.json", JSON.stringify(oldPlugin));
    put("plugins/old/server.ts", "export const untouched = true;\n");
    put("plugins/runtime/package.json", JSON.stringify(runtimeDependency));
    // What a removed plugin leaves in a checkout: ignored output, no manifest.
    put("plugins/removed/node_modules/dep/index.js", "");
    put("plugins/removed/dist/server.js", "");
    put("plugins/removed/coverage/lcov-report/index.js", "");
    put("plugins/removed/.DS_Store", "");
    put("plugins/removed/debug.log", "");
    const before = readFileSync(path.join(root, "package.json"), "utf8");
    const report = await buildReport(root);
    assert.deepEqual(
      report.plugins.map(({ name }) => name),
      ["bb-plugin-excluded", "bb-plugin-old", "bb-plugin-runtime"],
    );
    for (const coverage of Object.values(report.plugins[0].coverage))
      assert.equal(coverage.status, "excluded");
    // Ignoring only a manifest must not imply the whole package is excluded.
    assert.equal(report.plugins[1].coverage["format:check"].status, "included");
    assert.equal(report.policy.node, "24");
    assert.equal(report.testedCompatibility.status, "not-established");
    assert.deepEqual(await buildReport(root), report);
    assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), before);
    assert.match(renderReport(report), /Tested compatibility: not-established/);
    assert.match(renderReport(report), /test=excluded/);
    put(".prettierignore", "");
    assert.equal(
      (await buildReport(root)).plugins[0].coverage["format:check"].status,
      "included",
    );
    // Code without a manifest is still an error, not something to skip.
    put("plugins/removed/server.ts", "export default () => {};\n");
    await assert.rejects(
      buildReport(root),
      /plugins\/removed: missing package\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
