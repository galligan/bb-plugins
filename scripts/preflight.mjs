import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semver } from "bun";

const SDK = "@get-bb/plugin-sdk";
const exact = /^\d+\.\d+\.\d+$/;

/** Exit codes: a BB finding outranks a pin finding (SDK, Bun, TypeScript). */
export const exit = { current: 0, bb: 1, pin: 2 };

export function sdkPin(manifest) {
  return manifest.dependencies?.[SDK] ?? manifest.devDependencies?.[SDK];
}

function capture(run, command, args) {
  const result = run(command, args, { encoding: "utf8" });
  return result.error || result.status !== 0 ? undefined : result.stdout;
}

/**
 * Reads a package's `latest` version from npm: a stable release by convention,
 * and anything else is treated as no answer. After one lookup fails the
 * registry is not asked again, because each failure can take npm over a minute.
 */
function registry(run) {
  let reachable = true;
  return (name) => {
    if (!reachable) return undefined;
    const output = capture(run, "npm", ["view", name, "version"]);
    if (output === undefined) reachable = false;
    const version = output?.trim();
    return version && exact.test(version) ? version : undefined;
  };
}

/**
 * Compares one exact pin with npm latest and returns whether it is behind.
 * Only a lower pin is behind. A higher one means the registry answer lags.
 */
function behindLatest(latestOf, log, { label, name, pin, advice, current }) {
  const latest = latestOf(name);
  if (!latest) {
    log(`${label}: ${pin}. npm latest was not checked.`);
    return false;
  }
  const order = semver.order(pin, latest);
  if (order < 0) {
    log(`${label}: ${pin}; npm latest is ${latest}. ${advice(latest)}`);
    return true;
  }
  if (order > 0) {
    log(
      `${label}: ${pin}, newer than the npm latest reported (${latest}). No pin is behind.`,
    );
  } else if (current) {
    log(`${label}: ${pin}, ${current}.`);
  }
  return false;
}

function bbFinding(run, log) {
  let app;
  try {
    app = JSON.parse(capture(run, "bb", ["updates", "status", "--json"])).app;
  } catch {
    /* bb is missing, failed, or printed something other than its JSON. */
  }
  const current = app?.currentVersion;
  if (!current) {
    log(
      "BB installed: not checked. `bb updates status --json` returned no version.",
    );
    return false;
  }
  const latest = app.latestVersion;
  if (app.isDevelopment || current.includes("-")) {
    log(
      `BB installed: ${current}, a development or prerelease build. This repository targets the latest stable release${latest ? ` (${latest})` : ""}.`,
    );
    return true;
  }
  // Compare by version order: an installed release newer than a lagging update
  // feed is not behind, whatever `updateAvailable` says.
  const order = latest ? semver.order(current, latest) : undefined;
  if (order === undefined ? app.updateAvailable : order < 0) {
    log(
      `BB installed: ${current}; the latest stable release is ${latest ?? "newer"}. Update it with \`bb updates app\`, then rerun.`,
    );
    return true;
  }
  if (order === undefined) {
    log(
      `BB installed: ${current}. The latest stable release was not reported.`,
    );
  } else if (order > 0) {
    log(
      `BB installed: ${current}, newer than the update feed's latest stable release ${latest}.`,
    );
  } else {
    log(`BB installed: ${current}, the latest stable release.`);
  }
  return false;
}

// `bb plugin types --check` writes nothing and has no JSON form. When the
// probed package's pin differs from the SDK the running BB bundles it exits 1
// and prints "host is <version>"; exit 0 means that pin is the bundled version.
function bundledSdk(run, log, probe) {
  const result = run("bb", ["plugin", "types", "--check", probe.path], {
    encoding: "utf8",
  });
  const version = result.error
    ? undefined
    : (/\bhost is (\d+\.\d+\.\d+)/.exec(result.stdout ?? "")?.[1] ??
      (result.status === 0 ? probe.pin : undefined));
  log(`BB bundled SDK: ${version ?? "not checked"}.`);
  return version;
}

function sdkFinding(root, packages, latestOf, log) {
  const pin = sdkPin(root);
  if (!exact.test(pin ?? "")) {
    log(
      `Repo SDK pin: the root has no exact ${SDK} pin (${pin ?? "missing"}). Pin one exact version.`,
    );
    return true;
  }
  let finding = false;
  for (const { directory, manifest } of packages) {
    const own = sdkPin(manifest);
    if (own === pin) continue;
    finding = true;
    log(
      own === undefined
        ? `Repo SDK pin: ${directory} has no ${SDK} pin. Declare the root's exact pin, ${pin}.`
        : `Repo SDK pin: ${directory} pins ${own}; the root pins ${pin}. Use one exact pin in every package.`,
    );
  }
  const behind = behindLatest(latestOf, log, {
    label: "Repo SDK pin",
    name: SDK,
    pin,
    advice: (latest) =>
      `Set every ${SDK} pin to ${latest}, run \`bun install\`, then \`bun run verify\`.`,
    current: finding ? undefined : "the npm latest, in every package",
  });
  return behind || finding;
}

// Bun is pinned once, in the root `packageManager`. TypeScript is pinned in
// each package, and one exact pin is expected in all of them.
function toolchainFinding(root, packages, latestOf, log) {
  const move =
    "then regenerate `bun.lock` and run `bun run verify`; see docs/dev/verification.md.";
  const bun = /^bun@(\d+\.\d+\.\d+)$/.exec(root.packageManager ?? "")?.[1];
  let finding = !bun;
  if (bun) {
    finding = behindLatest(latestOf, log, {
      label: "Repo Bun pin",
      name: "bun",
      pin: bun,
      advice: (latest) =>
        `Set the root \`packageManager\` to \`bun@${latest}\`, ${move}`,
      current: "the npm latest",
    });
  } else {
    log(
      `Repo Bun pin: the root \`packageManager\` is not one exact Bun version (${root.packageManager ?? "missing"}).`,
    );
  }
  // Both sections are read: a second, different pin must not hide behind the first.
  const declared = packages.map(({ directory, manifest }) => ({
    directory,
    pins: [
      manifest.dependencies?.typescript,
      manifest.devDependencies?.typescript,
    ].filter((pin) => pin !== undefined),
  }));
  const bare = declared.filter(({ pins }) => pins.length === 0);
  if (bare.length > 0) {
    log(
      `Repo TypeScript pin: ${bare.map(({ directory }) => directory).join(", ")} declares no \`typescript\` pin. Declare the same exact pin in every package.`,
    );
    return true;
  }
  const pins = [...new Set(declared.flatMap(({ pins }) => pins))];
  if (pins.length !== 1 || !exact.test(pins[0])) {
    log(
      `Repo TypeScript pin: ${pins.join(", ") || "missing"}. Use one exact pin in every package.`,
    );
    return true;
  }
  return (
    behindLatest(latestOf, log, {
      label: "Repo TypeScript pin",
      name: "typescript",
      pin: pins[0],
      advice: (latest) => `Set every \`typescript\` pin to ${latest}, ${move}`,
      current: "the npm latest",
    }) || finding
  );
}

/**
 * Report separate facts: the installed BB against the latest stable release,
 * the SDK that BB bundles, and the repository's SDK, Bun and TypeScript pins
 * against npm latest. Reads only; never installs or edits anything.
 *
 * `probe` is the absolute path and SDK pin of any package that depends on the SDK.
 */
export function preflight({
  root,
  packages,
  probe,
  run = spawnSync,
  log = console.log,
}) {
  const bb = bbFinding(run, log);
  const bundled = bundledSdk(run, log, probe);
  const latestOf = registry(run);
  const sdk = sdkFinding(root, packages, latestOf, log);
  const toolchain = toolchainFinding(root, packages, latestOf, log);
  const pin = sdkPin(root);
  if (bundled && pin && bundled !== pin) {
    log(
      `Note: the repo pin (${pin}) is not the SDK this BB bundles (${bundled}). A newer pin does not prove this BB supports an API: check the public contract and harness or live evidence before relying on one newer than ${bundled}. \`bb plugin types\` and \`bb plugin new\` on this BB write ${bundled}; review that diff before keeping it.`,
    );
  }
  if (bb) {
    log("Preflight: stop and tell the user before plugin work.");
    return exit.bb;
  }
  if (sdk) {
    log(
      "Preflight: report the SDK pin. Continue unless the task needs the newer SDK.",
    );
  }
  if (toolchain) {
    log(
      "Preflight: report the Bun or TypeScript pin. Continue; moving it is a change of its own.",
    );
  }
  return sdk || toolchain ? exit.pin : exit.current;
}

/**
 * The packages whose pins are checked: every `plugins/*` directory that has
 * a `package.json`, and the scaffold. A directory without a manifest is not a
 * package: a removed plugin leaves one behind when its ignored `node_modules`
 * or `dist` outlive it in a checkout.
 */
export function discoverPackages(base) {
  const read = (directory) => ({
    directory,
    manifest: JSON.parse(
      readFileSync(path.join(base, directory, "package.json"), "utf8"),
    ),
  });
  return [
    ...readdirSync(path.join(base, "plugins"), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(path.join(base, "plugins", entry.name, "package.json")),
      )
      // Directory order is the filesystem's; findings are reported by name.
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((entry) => read(`plugins/${entry.name}`)),
    read("scaffolds/nav-panel"),
  ];
}

if (import.meta.main) {
  const base = fileURLToPath(new URL("../", import.meta.url));
  const packages = discoverPackages(base);
  const probed = packages.find(({ manifest }) => sdkPin(manifest));
  process.exitCode = preflight({
    root: JSON.parse(readFileSync(path.join(base, "package.json"), "utf8")),
    packages,
    probe: {
      path: path.join(base, probed.directory),
      pin: sdkPin(probed.manifest),
    },
  });
}
