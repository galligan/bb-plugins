import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semver } from "bun";

const SDK = "@get-bb/plugin-sdk";
const exact = /^\d+\.\d+\.\d+$/;

/** Exit codes: BB findings outrank SDK findings. */
export const exit = { current: 0, bb: 1, sdk: 2 };

export function sdkPin(manifest) {
  return manifest.dependencies?.[SDK] ?? manifest.devDependencies?.[SDK];
}

function capture(run, command, args) {
  const result = run(command, args, { encoding: "utf8" });
  return result.error || result.status !== 0 ? undefined : result.stdout;
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

function sdkFinding(root, packages, run, log) {
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
  const latest = capture(run, "npm", ["view", SDK, "version"])?.trim();
  if (!latest || !exact.test(latest)) {
    log(`Repo SDK pin: ${pin}. npm latest was not checked.`);
    return finding;
  }
  // Only a lower pin is behind. A higher one means the registry answer lags.
  const order = semver.order(pin, latest);
  if (order < 0) {
    log(
      `Repo SDK pin: ${pin}; npm latest is ${latest}. Set every ${SDK} pin to ${latest}, run \`bun install\`, then \`bun run verify\`.`,
    );
    return true;
  }
  if (order > 0) {
    log(
      `Repo SDK pin: ${pin}, newer than the npm latest reported (${latest}). No pin is behind.`,
    );
  } else if (!finding) {
    log(`Repo SDK pin: ${pin}, the npm latest, in every package.`);
  }
  return finding;
}

/**
 * Report three separate facts: the installed BB against the latest stable
 * release, the SDK that BB bundles, and the repository's SDK pin against npm
 * latest. Reads only; never installs or edits anything.
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
  const sdk = sdkFinding(root, packages, run, log);
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
    return exit.sdk;
  }
  return exit.current;
}

/**
 * The packages whose SDK pins are checked: every `plugins/*` directory that has
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
