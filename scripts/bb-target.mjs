import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Exit codes this command adds; otherwise it returns the forwarded command's. */
export const exit = { usage: 2, refused: 3 };

const DEFAULT_PORT = "38886";
/** The flags that name an instance. Commands built on `select` add their own. */
export const targetFlags = {
  "--url": "url",
  "--data-dir": "dataDir",
  "--daemon-port": "daemonPort",
  "--cli": "cli",
};
const usage = [
  "Usage: bun run bb-target --url <server-url> --data-dir <path>",
  "         [--daemon-port <port>] [--cli <bb-entry>] [--thread <thread-id>]",
  "         -- <bb arguments>",
  "",
  "Runs one bb command against the named BB instance, after checking that the",
  "instance at <server-url> reports <path> as its data directory. It refuses the",
  "default server port and the default data directory. It never starts, stops,",
  "installs, or retries anything.",
  "",
  "--thread runs the command as that thread, which a plugin command sees as its",
  "caller. The instance must confirm it has the thread; the thread's own project",
  "is used. Without it the command runs with no thread or project.",
].join("\n");

/** The path as the filesystem names it, or resolved lexically if absent. */
export function canonical(file, realpath) {
  const resolved = path.resolve(file);
  try {
    return realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Read `--flag value` pairs up to `--`, and the arguments after it. Returns
 * null for an unknown flag, a flag without a value, or a repeated flag.
 */
export function parseFlags(argv, flags) {
  const split = argv.indexOf("--");
  const head = split === -1 ? argv : argv.slice(0, split);
  const options = {};
  for (let index = 0; index < head.length; index += 2) {
    const name = flags[head[index]];
    const value = head[index + 1];
    if (name === undefined || value === undefined || name in options)
      return null;
    options[name] = value;
  }
  return { options, forwarded: split === -1 ? [] : argv.slice(split + 1) };
}

/**
 * Check that the named instance is an isolated one that answers as itself, and
 * return how to run bb against it: `{ bb, command, origin, dataDir }`, where
 * `bb(args, spawnOptions)` runs one command. Returns `{ code }` when the
 * instance is refused; nothing has been sent to it beyond `status --json`.
 *
 * The inherited environment is not trusted to select the target: every `BB_*`
 * variable is dropped, because inside a bb thread they point the CLI at the
 * instance that thread runs in.
 */
const threadId = /^thr_[A-Za-z0-9]+$/;

export function select(
  options,
  {
    env = process.env,
    run = spawnSync,
    realpath = realpathSync.native,
    home = homedir(),
    log = console.error,
  } = {},
) {
  let url;
  try {
    url = new URL(options.url);
  } catch {
    url = null;
  }
  if (url === null || !["http:", "https:"].includes(url.protocol)) {
    log(`bb-target: ${options.url} is not an http(s) server URL.`);
    return { code: exit.usage };
  }
  if (
    options.daemonPort !== undefined &&
    (!/^[1-9]\d{0,4}$/.test(options.daemonPort) ||
      Number(options.daemonPort) > 65535)
  ) {
    log("bb-target: --daemon-port must be a port number.");
    return { code: exit.usage };
  }
  if (options.thread !== undefined && !threadId.test(options.thread)) {
    log("bb-target: --thread must be a thread id, such as thr_abc123.");
    return { code: exit.usage };
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  // Refused on every host. A hostname can reach this machine in more spellings
  // than can be listed (a trailing dot, a DNS alias, its own LAN address), and
  // an isolated instance has no reason to use the default port.
  if (port === DEFAULT_PORT) {
    log(
      `bb-target: refused. ${url.origin} uses ${DEFAULT_PORT}, the default BB server port. Name an isolated instance on its own port.`,
    );
    return { code: exit.refused };
  }
  const dataDir = canonical(options.dataDir, realpath);
  if (dataDir === canonical(path.join(home, ".bb"), realpath)) {
    log(
      `bb-target: refused. ${dataDir} is the default BB data directory. Name an isolated instance.`,
    );
    return { code: exit.refused };
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
    return { code: exit.refused };
  }
  if (canonical(reported, realpath) !== dataDir) {
    log(
      `bb-target: refused. ${url.origin} serves ${reported}, not ${dataDir}; nothing was forwarded.`,
    );
    return { code: exit.refused };
  }

  // The bb CLI tells a plugin command who called it from these two variables
  // and nothing else. They are set only for a thread this instance has, with
  // that thread's own project, and the lookup itself runs as nobody.
  let caller = null;
  if (options.thread !== undefined) {
    const shown = run(
      command,
      [...prefix, "thread", "show", options.thread, "--json"],
      { env: { ...selected }, encoding: "utf8" },
    );
    let found;
    try {
      found = JSON.parse(shown.stdout).thread;
    } catch {
      /* Unreachable, failed, or not a thread document. */
    }
    if (
      shown.error ||
      shown.status !== 0 ||
      found?.id !== options.thread ||
      typeof found.projectId !== "string"
    ) {
      log(
        `bb-target: refused. ${url.origin} has no thread ${options.thread}; nothing was forwarded.`,
      );
      return { code: exit.refused };
    }
    caller = { threadId: found.id, projectId: found.projectId };
    selected.BB_THREAD_ID = caller.threadId;
    selected.BB_PROJECT_ID = caller.projectId;
  }
  return {
    bb: (args, spawnOptions) =>
      run(command, [...prefix, ...args], { env: selected, ...spawnOptions }),
    command,
    origin: url.origin,
    dataDir,
    caller,
  };
}

/**
 * Forward one bb command to an explicitly named instance. Forwarded arguments
 * are never printed.
 */
export function target({ argv, log = console.error, ...dependencies }) {
  const parsed = parseFlags(argv, { ...targetFlags, "--thread": "thread" });
  if (
    parsed === null ||
    !parsed.options.url ||
    !parsed.options.dataDir ||
    parsed.forwarded.length === 0
  ) {
    log(usage);
    return exit.usage;
  }
  const instance = select(parsed.options, { ...dependencies, log });
  if ("code" in instance) return instance.code;
  log(
    `bb-target: ${instance.origin} serves ${instance.dataDir}${instance.caller ? `; running as thread ${instance.caller.threadId} in project ${instance.caller.projectId}` : ""}.`,
  );
  const result = instance.bb(parsed.forwarded, { stdio: "inherit" });
  if (result.error) {
    log(
      `bb-target: could not run ${instance.command}: ${result.error.message}`,
    );
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exitCode = target({ argv: process.argv.slice(2) });
}
