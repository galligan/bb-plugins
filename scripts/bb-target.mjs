import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Exit codes this command adds; otherwise it returns the forwarded command's. */
export const exit = { usage: 2, refused: 3 };

const DEFAULT_PORT = "38886";
const FLAGS = {
  "--url": "url",
  "--data-dir": "dataDir",
  "--daemon-port": "daemonPort",
  "--cli": "cli",
};
const usage = [
  "Usage: bun run bb-target --url <server-url> --data-dir <path>",
  "         [--daemon-port <port>] [--cli <bb-entry>] -- <bb arguments>",
  "",
  "Runs one bb command against the named BB instance, after checking that the",
  "instance at <server-url> reports <path> as its data directory. It refuses the",
  "default instance. It never starts, stops, installs, or retries anything.",
].join("\n");

/** The path as the filesystem names it, or resolved lexically if absent. */
function canonical(file, realpath) {
  const resolved = path.resolve(file);
  try {
    return realpath(resolved);
  } catch {
    return resolved;
  }
}

/** Whether a URL host names this machine, in any spelling. */
function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.startsWith("127.") ||
    /^::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host)
  );
}

function parse(argv) {
  const split = argv.indexOf("--");
  if (split === -1) return null;
  const options = {};
  const flags = argv.slice(0, split);
  for (let index = 0; index < flags.length; index += 2) {
    const name = FLAGS[flags[index]];
    const value = flags[index + 1];
    if (name === undefined || value === undefined || name in options)
      return null;
    options[name] = value;
  }
  const forwarded = argv.slice(split + 1);
  if (!options.url || !options.dataDir || forwarded.length === 0) return null;
  return { ...options, forwarded };
}

/**
 * Forward one bb command to an explicitly named instance.
 *
 * The inherited environment is not trusted to select the target: every `BB_*`
 * variable is dropped, because inside a bb thread they point the CLI at the
 * instance that thread runs in. Forwarded arguments are never printed.
 */
export function target({
  argv,
  env = process.env,
  run = spawnSync,
  realpath = realpathSync.native,
  home = homedir(),
  log = console.error,
}) {
  const options = parse(argv);
  if (options === null) {
    log(usage);
    return exit.usage;
  }
  let url;
  try {
    url = new URL(options.url);
  } catch {
    url = null;
  }
  if (url === null || !["http:", "https:"].includes(url.protocol)) {
    log(`bb-target: ${options.url} is not an http(s) server URL.`);
    return exit.usage;
  }
  if (
    options.daemonPort !== undefined &&
    !/^[1-9]\d{0,4}$/.test(options.daemonPort)
  ) {
    log("bb-target: --daemon-port must be a port number.");
    return exit.usage;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (isLoopback(url.hostname) && port === DEFAULT_PORT) {
    log(
      `bb-target: refused. ${url.origin} is the default BB instance on this machine. Name an isolated instance.`,
    );
    return exit.refused;
  }
  const dataDir = canonical(options.dataDir, realpath);
  if (dataDir === canonical(path.join(home, ".bb"), realpath)) {
    log(
      `bb-target: refused. ${dataDir} is the default BB data directory. Name an isolated instance.`,
    );
    return exit.refused;
  }

  const selected = Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("BB_")),
  );
  selected.BB_SERVER_URL = url.origin;
  selected.BB_DATA_DIR = dataDir;
  if (options.daemonPort !== undefined)
    selected.BB_HOST_DAEMON_PORT = options.daemonPort;
  // A JavaScript entry, such as a source build's `dist/bb.js`, runs under Node.
  const [command, prefix] =
    options.cli === undefined
      ? ["bb", []]
      : /\.[cm]?js$/.test(options.cli)
        ? ["node", [options.cli]]
        : [options.cli, []];

  // The server, not this process, says which data directory it serves.
  const status = run(command, [...prefix, "status", "--json"], {
    env: selected,
    encoding: "utf8",
  });
  let reported;
  try {
    reported = JSON.parse(status.stdout).dataDir;
  } catch {
    /* Unreachable, failed, or not a bb status document. */
  }
  if (status.error || status.status !== 0 || typeof reported !== "string") {
    log(
      `bb-target: refused. Could not confirm which instance answers at ${url.origin}; nothing was forwarded.`,
    );
    return exit.refused;
  }
  if (canonical(reported, realpath) !== dataDir) {
    log(
      `bb-target: refused. ${url.origin} serves ${reported}, not ${dataDir}; nothing was forwarded.`,
    );
    return exit.refused;
  }

  log(`bb-target: ${url.origin} serves ${dataDir}.`);
  const result = run(command, [...prefix, ...options.forwarded], {
    env: selected,
    stdio: "inherit",
  });
  if (result.error) {
    log(`bb-target: could not run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exitCode = target({ argv: process.argv.slice(2) });
}
