import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const root = fileURLToPath(new URL("..", import.meta.url));
const SDK = "@get-bb/plugin-sdk";

test("source and tests import only the public SDK, package-local files, and declared dependencies", async () => {
  const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  // The SDK is left out so the scanner's own public-path rule still applies to it.
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter((name) => name !== SDK);
  const report = await experimental_scanPublicSdkOnly(root, {
    allow: [
      /^@\//, // tsconfig alias for this package's own files
      ...declared.map(
        (name) =>
          new RegExp(
            `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/.*)?$`,
          ),
      ),
    ],
  });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});
