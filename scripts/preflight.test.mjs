import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverPackages, exit, preflight, sdkPin } from "./preflight.mjs";

const stable = {
  currentVersion: "0.49.0",
  latestVersion: "0.49.0",
  updateAvailable: false,
  isDevelopment: false,
};
const pinned = (version, section = "devDependencies") => ({
  [section]: { "@get-bb/plugin-sdk": version },
});

function fixture({
  app = stable,
  bb = { status: 0, stdout: JSON.stringify({ app }) },
  types = {
    status: 1,
    stdout:
      "This plugin uses the npm package @get-bb/plugin-sdk; pin is 0.6.138, host is 0.6.132.\n",
  },
  npm = { status: 0, stdout: "0.6.138\n" },
  root = pinned("0.6.138"),
  packages = [
    { directory: "plugins/a", manifest: pinned("0.6.138") },
    { directory: "plugins/b", manifest: pinned("0.6.138", "dependencies") },
  ],
  // The toolchain is current unless a test says otherwise.
  packageManager = "bun@1.4.4",
  typescript = "7.0.2",
  registry = { bun: "1.4.4", typescript: "7.0.2" },
} = {}) {
  const calls = [];
  const lines = [];
  const code = preflight({
    root: { packageManager, ...root },
    packages: packages.map(({ directory, manifest }) => ({
      directory,
      manifest: {
        ...manifest,
        devDependencies: { typescript, ...manifest.devDependencies },
      },
    })),
    probe: { path: "/repo/plugins/a", pin: sdkPin(root) },
    log: (line) => lines.push(line),
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "npm") {
        if (args[1] === "@get-bb/plugin-sdk") return npm;
        const answer = registry[args[1]];
        return typeof answer === "string"
          ? { status: 0, stdout: `${answer}\n` }
          : answer;
      }
      return args[0] === "updates" ? bb : types;
    },
  });
  return { code, calls, output: lines.join("\n") };
}

test("reports current when BB is the latest stable and every pin is npm latest", () => {
  const f = fixture();
  assert.equal(f.code, exit.current);
  assert.deepEqual(f.calls, [
    ["bb", "updates", "status", "--json"],
    ["bb", "plugin", "types", "--check", "/repo/plugins/a"],
    ["npm", "view", "@get-bb/plugin-sdk", "version"],
    ["npm", "view", "bun", "version"],
    ["npm", "view", "typescript", "version"],
  ]);
  assert.match(f.output, /BB installed: 0\.49\.0, the latest stable release/);
  assert.match(f.output, /BB bundled SDK: 0\.6\.132\./);
  assert.match(f.output, /Repo SDK pin: 0\.6\.138, the npm latest, in every/);
  assert.match(f.output, /Repo Bun pin: 1\.4\.4, the npm latest\./);
  assert.match(f.output, /Repo TypeScript pin: 7\.0\.2, the npm latest\./);
  assert.doesNotMatch(f.output, /Preflight:/);
});

test("a BB behind latest stable stops work and names the update command", () => {
  for (const app of [
    { ...stable, latestVersion: "0.50.0", updateAvailable: true },
    { ...stable, latestVersion: "0.50.0" },
  ]) {
    const f = fixture({ app });
    assert.equal(f.code, exit.bb);
    assert.match(f.output, /0\.49\.0; the latest stable release is 0\.50\.0/);
    assert.match(f.output, /bb updates app/);
    assert.match(f.output, /stop and tell the user/);
  }
});

test("a nightly or development BB is not accepted as stable", () => {
  for (const app of [
    { ...stable, currentVersion: "0.49.1-nightly.42875372210.1" },
    { ...stable, isDevelopment: true },
  ]) {
    const f = fixture({ app });
    assert.equal(f.code, exit.bb);
    assert.match(f.output, /development or prerelease build/);
  }
});

test("an SDK pin behind npm latest is reported without stopping work", () => {
  const f = fixture({
    root: pinned("0.6.132"),
    packages: [{ directory: "plugins/a", manifest: pinned("0.6.132") }],
  });
  assert.equal(f.code, exit.pin);
  assert.match(f.output, /Repo SDK pin: 0\.6\.132; npm latest is 0\.6\.138/);
  assert.match(f.output, /Continue unless the task needs the newer SDK/);
});

test("a package pin that differs from the root is named", () => {
  const f = fixture({
    packages: [
      { directory: "plugins/a", manifest: pinned("0.6.138") },
      { directory: "plugins/old", manifest: pinned("0.6.132", "dependencies") },
    ],
  });
  assert.equal(f.code, exit.pin);
  assert.match(
    f.output,
    /plugins\/old pins 0\.6\.132; the root pins 0\.6\.138/,
  );
  assert.doesNotMatch(f.output, /plugins\/a pins/);
  assert.doesNotMatch(f.output, /the npm latest, in every/);
});

test("a package with no SDK pin is named instead of passing as pinned", () => {
  const f = fixture({
    packages: [
      { directory: "plugins/a", manifest: pinned("0.6.138") },
      { directory: "plugins/unpinned", manifest: {} },
    ],
  });
  assert.equal(f.code, exit.pin);
  assert.match(f.output, /plugins\/unpinned has no @get-bb\/plugin-sdk pin/);
  assert.doesNotMatch(f.output, /the npm latest, in every/);

  const rootless = fixture({ root: {} });
  assert.equal(rootless.code, exit.pin);
  assert.match(
    rootless.output,
    /the root has no exact @get-bb\/plugin-sdk pin \(missing\)/,
  );
  const ranged = fixture({ root: pinned("^0.6.138") });
  assert.equal(ranged.code, exit.pin);
  assert.match(
    ranged.output,
    /no exact @get-bb\/plugin-sdk pin \(\^0\.6\.138\)/,
  );
});

test("versions are compared by order, so a newer install or pin is never called behind", () => {
  // Installed BB ahead of a lagging update feed, even if the flag disagrees.
  for (const updateAvailable of [false, true]) {
    const f = fixture({
      app: { ...stable, currentVersion: "0.50.0", updateAvailable },
    });
    assert.equal(f.code, exit.current);
    assert.match(
      f.output,
      /BB installed: 0\.50\.0, newer than the update feed's latest stable release 0\.49\.0/,
    );
    assert.doesNotMatch(f.output, /bb updates app/);
  }
  // 0.10.0 is newer than 0.9.0; a string comparison would say otherwise.
  const numeric = fixture({
    app: { ...stable, currentVersion: "0.9.0", latestVersion: "0.10.0" },
  });
  assert.equal(numeric.code, exit.bb);

  // Repository pin ahead of what the registry reported.
  const pin = fixture({
    root: pinned("0.6.139"),
    packages: [{ directory: "plugins/a", manifest: pinned("0.6.139") }],
    types: { status: 0, stdout: "" },
  });
  assert.equal(pin.code, exit.current);
  assert.match(
    pin.output,
    /0\.6\.139, newer than the npm latest reported \(0\.6\.138\)\. No pin is behind/,
  );
  assert.doesNotMatch(pin.output, /Set every/);
});

test("without a reported latest stable release, only the update flag decides", () => {
  const unknown = fixture({ app: { ...stable, latestVersion: undefined } });
  assert.equal(unknown.code, exit.current);
  assert.match(unknown.output, /The latest stable release was not reported/);
  assert.doesNotMatch(unknown.output, /the latest stable release\./);
  const flagged = fixture({
    app: { ...stable, latestVersion: undefined, updateAvailable: true },
  });
  assert.equal(flagged.code, exit.bb);
});

test("a stale BB outranks a stale SDK pin", () => {
  const f = fixture({
    app: { ...stable, latestVersion: "0.50.0", updateAvailable: true },
    root: pinned("0.6.132"),
  });
  assert.equal(f.code, exit.bb);
  assert.match(f.output, /npm latest is 0\.6\.138/);
});

test("a check that could not run says so and never claims success", () => {
  for (const bb of [
    { error: new Error("spawn bb ENOENT") },
    { status: 1, stdout: "" },
    { status: 0, stdout: "not json" },
    { status: 0, stdout: JSON.stringify({}) },
  ]) {
    const f = fixture({ bb });
    assert.equal(f.code, exit.current);
    assert.match(f.output, /BB installed: not checked/);
    assert.doesNotMatch(f.output, /the latest stable release\./);
  }
  for (const npm of [
    { error: new Error("spawn npm ENOENT") },
    { status: 1, stdout: "" },
    { status: 0, stdout: "npm ERR! network\n" },
  ]) {
    const f = fixture({ npm });
    assert.equal(f.code, exit.current);
    assert.match(f.output, /npm latest was not checked/);
    assert.doesNotMatch(f.output, /the npm latest,/);
  }
});

test("a pin ahead of the bundled SDK is a compatibility note, not a failure", () => {
  const ahead = fixture();
  assert.equal(ahead.code, exit.current);
  assert.match(
    ahead.output,
    /repo pin \(0\.6\.138\) is not the SDK this BB bundles \(0\.6\.132\)/,
  );
  assert.match(ahead.output, /does not prove this BB supports an API/);
  assert.match(
    ahead.output,
    /`bb plugin types` and `bb plugin new` on this BB write 0\.6\.132/,
  );

  // Exit 0 means the probed package's pin is the bundled version.
  const matched = fixture({ types: { status: 0, stdout: "" } });
  assert.match(matched.output, /BB bundled SDK: 0\.6\.138\./);
  assert.doesNotMatch(matched.output, /Note:/);

  for (const types of [
    { error: new Error("spawn bb ENOENT") },
    { status: 1, stdout: "" },
    { status: 2, stdout: "unrecognized output\n" },
  ]) {
    const unknown = fixture({ types });
    assert.equal(unknown.code, exit.current);
    assert.match(unknown.output, /BB bundled SDK: not checked\./);
    assert.doesNotMatch(unknown.output, /Note:/);
  }
});

test("a Bun or TypeScript pin behind npm latest is reported without stopping work", () => {
  const bun = fixture({ registry: { bun: "1.4.5", typescript: "7.0.2" } });
  assert.equal(bun.code, exit.pin);
  assert.match(bun.output, /Repo Bun pin: 1\.4\.4; npm latest is 1\.4\.5/);
  assert.match(bun.output, /`packageManager` to `bun@1\.4\.5`/);
  assert.match(bun.output, /Repo TypeScript pin: 7\.0\.2, the npm latest\./);
  assert.match(bun.output, /Preflight: report the Bun or TypeScript pin/);
  assert.doesNotMatch(bun.output, /stop and tell the user/);
  assert.doesNotMatch(bun.output, /needs the newer SDK/);

  const compiler = fixture({ registry: { bun: "1.4.4", typescript: "7.0.3" } });
  assert.equal(compiler.code, exit.pin);
  assert.match(
    compiler.output,
    /Repo TypeScript pin: 7\.0\.2; npm latest is 7\.0\.3\. Set every `typescript` pin to 7\.0\.3/,
  );

  // 1.10.0 is newer than 1.4.4; a string comparison would say otherwise.
  assert.equal(
    fixture({ registry: { bun: "1.10.0", typescript: "7.0.2" } }).code,
    exit.pin,
  );

  // Both kinds of pin behind: one exit code, both instructions.
  const both = fixture({
    root: pinned("0.6.132"),
    registry: { bun: "1.4.5", typescript: "7.0.2" },
  });
  assert.equal(both.code, exit.pin);
  assert.match(both.output, /needs the newer SDK/);
  assert.match(both.output, /report the Bun or TypeScript pin/);
});

test("a prerelease or older registry answer never makes a toolchain pin stale", () => {
  // A prerelease under the `latest` tag is not a stable release to chase.
  const beta = fixture({
    registry: { bun: "1.4.4", typescript: "7.1.0-beta" },
  });
  assert.equal(beta.code, exit.current);
  assert.match(
    beta.output,
    /Repo TypeScript pin: 7\.0\.2\. npm latest was not checked/,
  );
  // A pin ahead of a lagging registry answer is not behind.
  const ahead = fixture({ registry: { bun: "1.4.3", typescript: "7.0.2" } });
  assert.equal(ahead.code, exit.current);
  assert.match(
    ahead.output,
    /Repo Bun pin: 1\.4\.4, newer than the npm latest reported \(1\.4\.3\)/,
  );
});

test("a toolchain pin that is missing, a range, or split across packages is named", () => {
  for (const packageManager of [null, "bun@^1.4.4", "pnpm@9.0.0"]) {
    const f = fixture({ packageManager });
    assert.equal(f.code, exit.pin);
    assert.match(f.output, /Repo Bun pin: the root `packageManager` is not/);
    assert.doesNotMatch(f.output, /Repo Bun pin: .*the npm latest/);
  }
  const ranged = fixture({ typescript: "^7.0.2" });
  assert.equal(ranged.code, exit.pin);
  assert.match(
    ranged.output,
    /Repo TypeScript pin: \^7\.0\.2\. Use one exact pin in every package/,
  );
  const split = fixture({
    packages: [
      { directory: "plugins/a", manifest: pinned("0.6.138") },
      {
        directory: "plugins/old",
        manifest: {
          ...pinned("0.6.138"),
          devDependencies: {
            "@get-bb/plugin-sdk": "0.6.138",
            typescript: "5.9.3",
          },
        },
      },
    ],
  });
  assert.equal(split.code, exit.pin);
  assert.match(split.output, /Repo TypeScript pin: 7\.0\.2, 5\.9\.3\. Use one/);
});

test("a stale BB outranks a stale toolchain pin", () => {
  const f = fixture({
    app: { ...stable, latestVersion: "0.50.0", updateAvailable: true },
    registry: { bun: "1.4.5", typescript: "7.0.2" },
  });
  assert.equal(f.code, exit.bb);
  assert.match(f.output, /npm latest is 1\.4\.5/);
});

test("after one failed registry lookup the registry is not asked again", () => {
  // A failed `npm view` can take over a minute to give up.
  for (const npm of [
    { error: new Error("spawn npm ENOENT") },
    { status: 1, stdout: "" },
  ]) {
    const f = fixture({ npm });
    assert.equal(f.code, exit.current);
    assert.equal(f.calls.filter(([command]) => command === "npm").length, 1);
    assert.match(
      f.output,
      /Repo Bun pin: 1\.4\.4\. npm latest was not checked/,
    );
    assert.match(
      f.output,
      /Repo TypeScript pin: 7\.0\.2\. npm latest was not checked/,
    );
  }
  // An answer that is not a version came from a registry that did respond.
  const garbled = fixture({ npm: { status: 0, stdout: "npm ERR! network\n" } });
  assert.equal(
    garbled.calls.filter(([command]) => command === "npm").length,
    3,
  );
});

test("reads the SDK pin from either dependency section", () => {
  assert.equal(sdkPin(pinned("1.0.0")), "1.0.0");
  assert.equal(sdkPin(pinned("1.0.0", "dependencies")), "1.0.0");
  assert.equal(sdkPin({}), undefined);
});

test("discovers packages by manifest and skips a leftover directory without one", (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "preflight-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (file, contents) => {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), contents);
  };
  // Created out of order: discovery sorts by name, whatever the filesystem lists.
  put("plugins/b/package.json", JSON.stringify(pinned("0.6.138")));
  put("plugins/a/package.json", JSON.stringify(pinned("0.6.138")));
  // What a removed plugin leaves in a checkout: ignored output, no manifest.
  put("plugins/removed/node_modules/dep/index.js", "");
  put("plugins/removed/dist/server.js", "");
  put("plugins/README.md", "not a directory");
  put("scaffolds/nav-panel/package.json", JSON.stringify(pinned("0.6.138")));
  assert.deepEqual(
    discoverPackages(base).map(({ directory }) => directory),
    ["plugins/a", "plugins/b", "scaffolds/nav-panel"],
  );
});
