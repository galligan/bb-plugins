import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SDK = "@get-bb/plugin-sdk";

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
  if (app.updateAvailable || (latest && latest !== current)) {
    log(
      `BB installed: ${current}; the latest stable release is ${latest ?? "unknown"}. Update it with \`bb updates app\`, then rerun.`,
    );
    return true;
  }
  log(`BB installed: ${current}, the latest stable release.`);
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
  let behind = false;
  for (const { directory, manifest } of packages) {
    const own = sdkPin(manifest);
    if (!own || own === pin) continue;
    behind = true;
    log(
      `Repo SDK pin: ${directory} pins ${own}; the root pins ${pin}. Use one exact pin in every package.`,
    );
  }
  const latest = capture(run, "npm", ["view", SDK, "version"])?.trim();
  if (!latest || !/^\d+\.\d+\.\d+$/.test(latest)) {
    log(`Repo SDK pin: ${pin}. npm latest was not checked.`);
    return behind;
  }
  if (pin !== latest) {
    log(
      `Repo SDK pin: ${pin}; npm latest is ${latest}. Set every ${SDK} pin to ${latest}, run \`bun install\`, then \`bun run verify\`.`,
    );
    return true;
  }
  if (!behind) log(`Repo SDK pin: ${pin}, the npm latest, in every package.`);
  return behind;
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

if (import.meta.main) {
  const base = fileURLToPath(new URL("../", import.meta.url));
  const read = (directory) => ({
    directory,
    manifest: JSON.parse(
      readFileSync(path.join(base, directory, "package.json"), "utf8"),
    ),
  });
  const packages = [
    ...readdirSync(path.join(base, "plugins"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => read(`plugins/${entry.name}`)),
    read("scaffolds/nav-panel"),
  ];
  const probed = packages.find(({ manifest }) => sdkPin(manifest));
  process.exitCode = preflight({
    root: read(".").manifest,
    packages,
    probe: {
      path: path.join(base, probed.directory),
      pin: sdkPin(probed.manifest),
    },
  });
}
