import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  canonical,
  exit as targetExit,
  parseFlags,
  select,
  targetFlags,
} from "./bb-target.mjs";

/**
 * `failed`: bb did not run the plugin from the artifact, or the probe failed,
 * and the original install is verified back in place. `unverified`: the final
 * state is not known to be the original install; a person has to look.
 */
export const exit = {
  passed: 0,
  failed: 1,
  usage: 2,
  refused: 3,
  unverified: 4,
};

const flags = {
  ...targetFlags,
  "--plugin": "plugin",
  "--artifact": "artifact",
  "--original": "original",
  "--receipt": "receipt",
};
const required = [
  "url",
  "dataDir",
  "plugin",
  "artifact",
  "original",
  "receipt",
];
const usage = [
  "Usage: bun run load-check --url <server-url> --data-dir <path>",
  "         [--daemon-port <port>] [--cli <bb-entry>] --plugin <id>",
  "         --artifact <plugin-dir> --original <plugin-dir> --receipt <file>",
  "         [-- <read-only bb arguments>]",
  "",
  "Proves that a built plugin directory starts on an isolated BB instance. The",
  "plugin must already run there from <original>, a local path. The command",
  "moves it to <artifact> with `bb plugin install`, checks that it runs from",
  "there, optionally runs one read-only bb command, moves it back, and checks",
  "that it runs from <original> again. Each install is sent once, never retried.",
  "The receipt is rewritten after every step. If this process is killed between",
  "the two installs the plugin stays on the artifact: the receipt's",
  "`restoreArguments` are the bb arguments that move it back.",
].join("\n");

// One install on a loaded machine took under a minute; these bound a hang.
const COMMAND_TIMEOUT_MS = 180_000;
const POLLS = 45;
const POLL_MS = 2_000;
// How many further polls must agree before an install whose command gave no
// exit is taken as not having arrived.
const LATE_POLLS = 5;
const settledJobs = new Set(["succeeded", "failed", "cancelled"]);

function packageName(directory) {
  try {
    return JSON.parse(
      readFileSync(path.join(directory, "package.json"), "utf8"),
    ).name;
  } catch {
    return undefined;
  }
}

const view = ({ id, version, enabled, status, source, rootDir }) => ({
  id,
  version,
  enabled,
  status,
  source,
  rootDir,
});

/**
 * Move a path-installed plugin to a built artifact, check that it runs, and
 * move it back. See `usage`. Forwarded probe arguments are never printed or
 * written to the receipt.
 */
export function loadCheck({
  argv,
  env = process.env,
  run = spawnSync,
  realpath = realpathSync.native,
  home = homedir(),
  log = console.error,
  sleep = (ms) => Bun.sleepSync(ms),
  now = () => new Date().toISOString(),
}) {
  const parsed = parseFlags(argv, flags);
  if (parsed === null || required.some((name) => !parsed.options[name])) {
    log(usage);
    return exit.usage;
  }
  const options = parsed.options;
  const artifact = canonical(options.artifact, realpath);
  const original = canonical(options.original, realpath);
  const receipt = {
    schema: 1,
    plugin: options.plugin,
    artifact,
    original,
    target: null,
    startedAt: now(),
    finishedAt: null,
    outcome: null,
    exit: null,
    baseline: null,
    loaded: null,
    final: null,
    othersUnchanged: null,
    probe: null,
    primaryError: null,
    restoreError: null,
    restoreArguments: ["plugin", "install", original, "--yes"],
    steps: [],
  };
  const text = () => `${JSON.stringify(receipt, null, 2)}\n`;
  // Written whole and renamed, so a failed write leaves the last receipt.
  const write = () => {
    writeFileSync(`${options.receipt}.tmp`, text());
    renameSync(`${options.receipt}.tmp`, options.receipt);
  };
  // Once an install may have been sent, a receipt that cannot be written must
  // not stop the run: the restore matters more than the record.
  let unsaved = false;
  const save = () => {
    try {
      write();
      unsaved = false;
    } catch (error) {
      if (!unsaved) {
        log(
          `load-check: could not write the receipt (${error.message}); it is printed when the run ends.`,
        );
      }
      unsaved = true;
    }
  };
  const step = (name, detail) => {
    receipt.steps.push({ step: name, at: now(), ...detail });
    save();
  };
  const finish = (outcome, message) => {
    receipt.outcome = outcome;
    receipt.exit = exit[outcome];
    receipt.finishedAt = now();
    save();
    if (unsaved) log(text());
    log(`load-check: ${outcome}. ${message} Receipt: ${options.receipt}`);
    return exit[outcome];
  };
  const refuse = (message) => finish("refused", `${message} Nothing changed.`);

  // Everything up to the first install can refuse without changing anything.
  try {
    write();
  } catch (error) {
    log(`load-check: cannot write ${options.receipt}: ${error.message}`);
    return exit.usage;
  }
  const name = packageName(artifact);
  if (name === undefined || name !== packageName(original)) {
    return refuse(
      "--artifact and --original must each hold a package.json with the same name.",
    );
  }
  if (artifact === original) {
    return refuse("--artifact and --original are the same directory.");
  }
  const instance = select(options, { env, run, realpath, home, log });
  if ("code" in instance) {
    return instance.code === targetExit.usage
      ? exit.usage
      : refuse("The instance was refused.");
  }
  receipt.target = { origin: instance.origin, dataDir: instance.dataDir };
  const bb = (args) =>
    instance.bb(args, { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS });
  const json = (args) => {
    try {
      return JSON.parse(bb(args).stdout);
    } catch {
      return undefined;
    }
  };
  const plugins = () => {
    const list = json(["plugin", "list", "--json"])?.plugins;
    return Array.isArray(list) ? list : undefined;
  };
  const activeInstalls = () => {
    const jobs = json(["plugin", "install-jobs", "--json"])?.jobs;
    return Array.isArray(jobs)
      ? jobs.filter(({ state }) => !settledJobs.has(state)).length
      : undefined;
  };
  const others = (list) =>
    JSON.stringify(
      list
        .filter(({ id }) => id !== options.plugin)
        .map(view)
        .sort((a, b) => String(a.id).localeCompare(String(b.id), "en")),
    );

  const before = plugins();
  if (before === undefined) {
    return refuse("`bb plugin list --json` returned no plugin list.");
  }
  const installed = before.find(({ id }) => id === options.plugin);
  if (installed === undefined) {
    return refuse(`${options.plugin} is not installed on this instance.`);
  }
  receipt.baseline = view(installed);
  if (!String(installed.source).startsWith("path:")) {
    return refuse(
      `${options.plugin} is installed from ${installed.source}. Only a local path install can be moved.`,
    );
  }
  if (canonical(String(installed.rootDir), realpath) !== original) {
    return refuse(
      `${options.plugin} runs from ${installed.rootDir}, not from --original.`,
    );
  }
  if (!installed.enabled || installed.status !== "running") {
    return refuse(
      `${options.plugin} is ${installed.enabled ? installed.status : "disabled"}. A move keeps that state, so it would not show the artifact starting.`,
    );
  }
  const busy = activeInstalls();
  if (busy !== 0) {
    return refuse(
      busy === undefined
        ? "`bb plugin install-jobs --json` returned no job list."
        : "Another plugin install is queued or running on this instance.",
    );
  }
  step("baseline", { observed: receipt.baseline });

  // An install command that times out or loses its connection may still have
  // been accepted: installs continue on the server. So the answer to "what
  // happened" always comes from here, never from the command's exit alone.
  //
  // `uncertain` is for a command that gave no exit. Its install can register
  // after the queue first looks empty, so the original path is believed only
  // once several polls in a row agree.
  const observe = (name, uncertain = false) => {
    let steady = 0;
    for (let attempt = 0; attempt < POLLS; attempt += 1) {
      if (attempt > 0) sleep(POLL_MS);
      const list = activeInstalls() === 0 ? plugins() : undefined;
      const entry = list?.find(({ id }) => id === options.plugin);
      if (entry === undefined) {
        steady = 0;
        continue;
      }
      const root = canonical(String(entry.rootDir), realpath);
      const at =
        root === artifact
          ? "artifact"
          : root === original
            ? "original"
            : "other";
      const running = entry.enabled === true && entry.status === "running";
      if (uncertain && at === "original" && (steady += 1) <= LATE_POLLS) {
        continue;
      }
      step(name, { at, observed: view(entry) });
      return { at, running, entry, list };
    }
    step(name, { at: null, observed: null });
    return undefined;
  };
  const install = (name, directory) => {
    const result = bb(["plugin", "install", directory, "--yes"]);
    const sent = {
      exit: result.status ?? null,
      signal: result.signal ?? null,
      error: result.error?.message ?? null,
    };
    step(name, sent);
    return sent;
  };
  const describe = (sent) =>
    sent.error === null ? `exit ${sent.exit}` : `no exit: ${sent.error}`;

  const noExit = (sent) => sent.error !== null || sent.exit === null;
  const onArtifact = (seen) => {
    moved = true;
    receipt.loaded = view(seen.entry);
    receipt.othersUnchanged = others(seen.list) === others(before);
  };
  let moved = false;
  let crashed = false;
  try {
    const sent = install("install", artifact);
    const seen = observe("after-install", noExit(sent));
    if (seen === undefined) {
      receipt.primaryError = `After the install command (${describe(sent)}) the plugin's state could not be read.`;
      return finish(
        "unverified",
        `${receipt.primaryError} No restore was sent. Read \`plugin list --json\` before doing anything else.`,
      );
    }
    if (seen.at !== "artifact") {
      receipt.final = view(seen.entry);
      receipt.primaryError =
        seen.at === "original"
          ? `bb did not run ${options.plugin} from the artifact (install command: ${describe(sent)}).`
          : `After the install command ${options.plugin} runs from ${seen.entry.rootDir}, which is neither path. Something else changed it.`;
      if (seen.at === "original" && noExit(sent)) {
        return finish(
          "unverified",
          `${receipt.primaryError} The command gave no exit, so the install may still arrive: read \`plugin install-jobs\` and \`plugin list --json\` before relying on this state. No restore was sent.`,
        );
      }
      return seen.at === "original" && seen.running
        ? finish(
            "failed",
            `${receipt.primaryError} The original install is running.`,
          )
        : finish("unverified", `${receipt.primaryError} No restore was sent.`);
    }
    onArtifact(seen);
    if (!seen.running) {
      receipt.primaryError = `${options.plugin} moved to the artifact but is ${seen.entry.enabled ? seen.entry.status : "disabled"}, not running.`;
    } else if (parsed.forwarded.length > 0) {
      const result = bb(parsed.forwarded);
      const output = result.stdout ?? "";
      let outputSaved = true;
      try {
        writeFileSync(`${options.receipt}.probe.out`, output);
      } catch {
        outputSaved = false;
      }
      receipt.probe = {
        exit: result.status ?? null,
        error: result.error?.message ?? null,
        outputSaved,
        stdoutBytes: Buffer.byteLength(output),
        stdoutSha256: createHash("sha256").update(output).digest("hex"),
      };
      step("probe", { exit: receipt.probe.exit });
      if (result.status !== 0) {
        receipt.primaryError = `The probe command failed while ${options.plugin} ran from the artifact (${describe(receipt.probe)}).`;
      }
    }
  } catch (error) {
    // An ordinary failure of this script. The restore below still runs if the
    // plugin was seen on the artifact.
    receipt.primaryError = `load-check failed: ${error?.message ?? error}`;
    crashed = true;
  } finally {
    if (crashed && !moved) {
      // The install may have been sent before the failure. Find out.
      try {
        const seen = observe("after-error", true);
        if (seen?.at === "artifact") onArtifact(seen);
      } catch {
        /* Unknown state: reported below as unverified. */
      }
    }
    if (moved) {
      try {
        const sent = install("restore", original);
        const seen = observe("after-restore");
        receipt.final = seen ? view(seen.entry) : null;
        if (seen === undefined) {
          receipt.restoreError = `After the restore command (${describe(sent)}) the plugin's state could not be read.`;
        } else if (seen.at !== "original" || !seen.running) {
          receipt.restoreError = `After the restore command (${describe(sent)}) ${options.plugin} runs from ${seen.entry.rootDir} and is ${seen.entry.enabled ? seen.entry.status : "disabled"}.`;
        } else {
          receipt.othersUnchanged &&= others(seen.list) === others(before);
        }
      } catch (error) {
        receipt.restoreError = `load-check failed while restoring: ${error?.message ?? error}`;
      }
    }
  }
  if (!moved) {
    return finish(
      "unverified",
      `${receipt.primaryError} The plugin's state was not confirmed. Read \`plugin list --json\` before doing anything else.`,
    );
  }
  if (receipt.restoreError !== null) {
    return finish(
      "unverified",
      `${receipt.primaryError ?? "The artifact ran."} ${receipt.restoreError} The restore was sent once and is not retried; \`restoreArguments\` in the receipt move it back.`,
    );
  }
  if (receipt.primaryError !== null) {
    return finish(
      "failed",
      `${receipt.primaryError} The original install is running again.`,
    );
  }
  return finish(
    "passed",
    `${options.plugin} ran from the artifact and runs from the original path again.${receipt.othersUnchanged ? "" : " Another plugin's listing changed meanwhile; see the receipt."}`,
  );
}

if (import.meta.main) {
  process.exitCode = loadCheck({ argv: process.argv.slice(2) });
}
