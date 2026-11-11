import assert from "node:assert/strict";
import { test } from "node:test";
import { exit, preflight, sdkPin } from "./preflight.mjs";

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
    { directory: "plugins/no-sdk", manifest: {} },
  ],
} = {}) {
  const calls = [];
  const lines = [];
  const code = preflight({
    root,
    packages,
    probe: { path: "/repo/plugins/a", pin: sdkPin(root) },
    log: (line) => lines.push(line),
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "npm") return npm;
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
  ]);
  assert.match(f.output, /BB installed: 0\.49\.0, the latest stable release/);
  assert.match(f.output, /BB bundled SDK: 0\.6\.132\./);
  assert.match(f.output, /Repo SDK pin: 0\.6\.138, the npm latest, in every/);
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
  assert.equal(f.code, exit.sdk);
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
  assert.equal(f.code, exit.sdk);
  assert.match(
    f.output,
    /plugins\/old pins 0\.6\.132; the root pins 0\.6\.138/,
  );
  assert.doesNotMatch(f.output, /plugins\/a pins/);
  assert.doesNotMatch(f.output, /the npm latest, in every/);
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

test("reads the SDK pin from either dependency section", () => {
  assert.equal(sdkPin(pinned("1.0.0")), "1.0.0");
  assert.equal(sdkPin(pinned("1.0.0", "dependencies")), "1.0.0");
  assert.equal(sdkPin({}), undefined);
});
