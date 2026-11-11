import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exit, loadCheck } from "./load-check.mjs";

// A fake bb: one instance with a plugin list and an install queue. `install`
// decides what an install command does to it; by default it moves the plugin.
function fixture(t, configure = () => {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "load-check-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const directory = (name, packageName = "bb-plugin-sample") => {
    const full = path.join(base, name);
    mkdirSync(full, { recursive: true });
    writeFileSync(
      path.join(full, "package.json"),
      JSON.stringify({ name: packageName }),
    );
    return full;
  };
  const original = directory("original/plugins/sample");
  const artifact = directory("artifact/plugins/sample");
  const dataDir = path.join(base, "data");
  const entry = (id, rootDir, extra = {}) => ({
    id,
    version: "0.1.0",
    enabled: true,
    status: "running",
    source: `path:${rootDir}`,
    rootDir,
    ...extra,
  });
  const bb = {
    plugins: [
      entry("sample", original),
      entry("other", path.join(base, "other")),
    ],
    jobs: [],
    listReadable: true,
    install(target) {
      bb.plugins[0] = entry("sample", target);
      return { status: 0, stdout: "Installed:\n" };
    },
    probe: () => ({ status: 0, stdout: '{"ok":true}\n' }),
  };
  const state = {
    base,
    original,
    artifact,
    dataDir,
    bb,
    entry,
    directory,
    args: {
      plugin: "sample",
      artifact,
      original,
      url: "http://127.0.0.1:26207",
      probe: ["sample", "read", "--token", "s3cret"],
    },
  };
  configure(state);

  const calls = [];
  const lines = [];
  const sleeps = [];
  const receiptDirectory = path.join(base, "receipts");
  mkdirSync(receiptDirectory);
  state.receiptDirectory = receiptDirectory;
  const receiptFile = path.join(receiptDirectory, "receipt.json");
  const { plugin, url, probe } = state.args;
  const code = loadCheck({
    argv: [
      "--url",
      url,
      "--data-dir",
      dataDir,
      ...(plugin === undefined ? [] : ["--plugin", plugin]),
      "--artifact",
      state.args.artifact,
      "--original",
      state.args.original,
      "--receipt",
      receiptFile,
      ...(probe.length > 0 ? ["--", ...probe] : []),
    ],
    env: { PATH: "/bin", BB_SERVER_URL: "http://127.0.0.1:38886" },
    home: path.join(base, "home"),
    log: (line) => lines.push(line),
    sleep: (ms) => {
      sleeps.push(ms);
      state.onSleep?.(sleeps.length);
    },
    now: () => "2026-11-11T00:00:00.000Z",
    run: (_command, args) => {
      calls.push(args);
      const [first, second] = args;
      if (first === "status") {
        return { status: 0, stdout: JSON.stringify({ dataDir }) };
      }
      if (first === "plugin" && second === "list") {
        return bb.listReadable
          ? { status: 0, stdout: JSON.stringify({ plugins: bb.plugins }) }
          : { status: 1, stdout: "" };
      }
      if (first === "plugin" && second === "install-jobs") {
        return { status: 0, stdout: JSON.stringify({ jobs: bb.jobs }) };
      }
      if (first === "plugin" && second === "install")
        return bb.install(args[2]);
      return bb.probe(args);
    },
  });
  let receipt = null;
  try {
    receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
  } catch {
    /* A usage error writes none. */
  }
  return {
    ...state,
    code,
    receipt,
    receiptFile,
    sleeps,
    output: lines.join("\n"),
    installs: calls
      .filter(([first, second]) => first === "plugin" && second === "install")
      .map((args) => args[2]),
    calls,
  };
}

test("moves the plugin to the artifact, probes it, moves it back, and records each step", (t) => {
  const f = fixture(t);
  assert.equal(f.code, exit.passed, f.output);
  assert.deepEqual(f.installs, [f.artifact, f.original]);
  assert.equal(f.receipt.outcome, "passed");
  assert.equal(f.receipt.exit, 0);
  assert.equal(f.receipt.baseline.rootDir, f.original);
  assert.equal(f.receipt.loaded.rootDir, f.artifact);
  assert.equal(f.receipt.loaded.status, "running");
  assert.equal(f.receipt.final.rootDir, f.original);
  assert.equal(f.receipt.othersUnchanged, true);
  assert.equal(f.receipt.primaryError, null);
  assert.equal(f.receipt.restoreError, null);
  assert.deepEqual(
    f.receipt.steps.map(({ step }) => step),
    [
      "baseline",
      "install",
      "after-install",
      "probe",
      "restore",
      "after-restore",
    ],
  );
  // Every step is timed, and an observation says where the plugin was.
  assert.ok(
    f.receipt.steps.every(({ at }) => at === "2026-11-11T00:00:00.000Z"),
  );
  assert.deepEqual(
    f.receipt.steps.flatMap(({ where }) =>
      where === undefined ? [] : [where],
    ),
    ["artifact", "original"],
  );
  assert.deepEqual(f.receipt.target, {
    origin: "http://127.0.0.1:26207",
    dataDir: f.dataDir,
  });
  assert.deepEqual(f.receipt.restoreArguments, [
    "plugin",
    "install",
    f.original,
    "--yes",
  ]);

  // The probe ran while the plugin was on the artifact, and its output is kept
  // beside the receipt; its arguments are in neither the output nor the receipt.
  const probeAt = f.calls.findIndex(([first]) => first === "sample");
  const restoreAt = f.calls.findIndex(
    (args) => args[1] === "install" && args[2] === f.original,
  );
  assert.ok(probeAt > 0 && probeAt < restoreAt);
  assert.equal(f.receipt.probe.exit, 0);
  assert.equal(f.receipt.probe.stdoutBytes, 12);
  assert.equal(
    readFileSync(`${f.receiptFile}.probe.out`, "utf8"),
    '{"ok":true}\n',
  );
  assert.doesNotMatch(f.output + JSON.stringify(f.receipt), /s3cret|--token/);
  assert.match(f.output, /load-check: passed\./);
});

test("refuses before any install when the plugin, its source, or the instance is not what was named", (t) => {
  const cases = {
    "is not installed": (s) => {
      s.args.plugin = "absent";
    },
    "Only a local path install can be moved": (s) => {
      s.bb.plugins[0] = s.entry("sample", s.original, {
        source: "git:https://example.test/repo.git@0123abc",
      });
    },
    "not from --original": (s) => {
      s.bb.plugins[0] = s.entry("sample", path.join(s.base, "elsewhere"));
    },
    "is disabled": (s) => {
      s.bb.plugins[0] = s.entry("sample", s.original, {
        enabled: false,
        status: "disabled",
      });
    },
    "is error": (s) => {
      s.bb.plugins[0] = s.entry("sample", s.original, { status: "error" });
    },
    "Another plugin install is queued or running": (s) => {
      s.bb.jobs = [{ id: "j1", state: "running" }];
    },
    "returned no plugin list": (s) => {
      s.bb.listReadable = false;
    },
    "package.json with the same name": (s) => {
      s.args.artifact = s.directory("wrong/plugins/sample", "bb-plugin-other");
    },
    "are the same directory": (s) => {
      s.args.artifact = s.original;
    },
    "The instance was refused": (s) => {
      s.args.url = "http://127.0.0.1:38886";
    },
  };
  for (const [message, configure] of Object.entries(cases)) {
    const f = fixture(t, configure);
    assert.equal(f.code, exit.refused, message);
    assert.deepEqual(f.installs, [], message);
    assert.equal(f.receipt.outcome, "refused", message);
    assert.match(f.output, new RegExp(message), message);
    assert.match(f.output, /Nothing changed\./, message);
  }
});

test("a usage error sends nothing and writes no receipt", (t) => {
  const f = fixture(t, (s) => {
    s.args.plugin = undefined;
  });
  assert.equal(f.code, exit.usage);
  assert.deepEqual(f.calls, []);
  assert.equal(f.receipt, null);
  assert.match(f.output, /Usage: bun run load-check/);
});

test("an artifact that bb will not start is a failure with the original verified, and no restore is sent", (t) => {
  const f = fixture(t, (s) => {
    // bb keeps the old install when the new checkout fails to start.
    s.bb.install = () => ({ status: 1, stdout: "", stderr: "failed to start" });
  });
  assert.equal(f.code, exit.failed);
  assert.deepEqual(f.installs, [f.artifact]);
  assert.equal(f.receipt.outcome, "failed");
  assert.match(f.receipt.primaryError, /did not run sample from the artifact/);
  assert.match(f.receipt.primaryError, /exit 1/);
  assert.equal(f.receipt.final.rootDir, f.original);
  assert.equal(f.receipt.loaded, null);
  assert.equal(f.receipt.restoreError, null);

  // If the original is left stopped, that is not a clean failure.
  const stopped = fixture(t, (s) => {
    s.bb.install = () => {
      s.bb.plugins[0] = s.entry("sample", s.original, { status: "error" });
      return { status: 1, stdout: "" };
    };
  });
  assert.equal(stopped.code, exit.unverified);
  assert.deepEqual(stopped.installs, [stopped.artifact]);
  assert.equal(stopped.receipt.final.status, "error");
});

test("an install whose delivery is uncertain is settled by observation, never by a second install", (t) => {
  // The command timed out, but the server had accepted it and the job is still
  // running: wait for it, then find the plugin on the artifact and carry on.
  const delivered = fixture(t, (s) => {
    s.bb.install = (target) => {
      if (target === s.artifact) {
        s.bb.jobs = [{ id: "j1", state: "running" }];
        s.onSleep = (count) => {
          if (count < 2) return;
          s.bb.jobs = [{ id: "j1", state: "succeeded" }];
          s.bb.plugins[0] = s.entry("sample", s.artifact);
        };
        return {
          status: null,
          signal: "SIGTERM",
          error: new Error("ETIMEDOUT"),
        };
      }
      s.bb.plugins[0] = s.entry("sample", target);
      return { status: 0, stdout: "" };
    };
  });
  assert.equal(delivered.code, exit.passed, delivered.output);
  assert.deepEqual(delivered.installs, [
    delivered.artifact,
    delivered.original,
  ]);
  assert.deepEqual(delivered.sleeps, [2000, 2000]);
  assert.equal(delivered.receipt.steps[1].error, "ETIMEDOUT");
  assert.equal(delivered.receipt.steps[1].exit, null);

  // The command timed out and nothing shows it was accepted. It may still
  // arrive, so this is not a clean failure: one install, no restore, exit 4.
  const dropped = fixture(t, (s) => {
    s.bb.install = () => ({ status: null, error: new Error("ETIMEDOUT") });
  });
  assert.equal(dropped.code, exit.unverified);
  assert.deepEqual(dropped.installs, [dropped.artifact]);
  assert.match(dropped.receipt.primaryError, /no exit: ETIMEDOUT/);
  assert.match(dropped.output, /may still arrive/);
  // It kept watching for a late arrival before giving up.
  assert.deepEqual(dropped.sleeps, [2000, 2000, 2000, 2000, 2000]);

  // The command timed out, the queue looked empty, and the install arrived a
  // moment later: the watch catches it and the plugin is moved back.
  const late = fixture(t, (s) => {
    s.bb.install = (target) => {
      if (target === s.artifact) {
        s.onSleep = (count) => {
          if (count === 2) s.bb.jobs = [{ id: "j1", state: "running" }];
          if (count === 3) {
            s.bb.jobs = [{ id: "j1", state: "succeeded" }];
            s.bb.plugins[0] = s.entry("sample", s.artifact);
          }
        };
        return { status: null, error: new Error("ETIMEDOUT") };
      }
      s.bb.plugins[0] = s.entry("sample", target);
      return { status: 0, stdout: "" };
    };
  });
  assert.equal(late.code, exit.passed, late.output);
  assert.deepEqual(late.installs, [late.artifact, late.original]);
  assert.equal(late.receipt.final.rootDir, late.original);

  // The state cannot be read afterwards: stop, and send nothing more.
  const blind = fixture(t, (s) => {
    s.bb.install = () => {
      s.bb.listReadable = false;
      return { status: null, error: new Error("ECONNRESET") };
    };
  });
  assert.equal(blind.code, exit.unverified);
  assert.deepEqual(blind.installs, [blind.artifact]);
  assert.equal(blind.sleeps.length, 44);
  assert.match(blind.receipt.primaryError, /state could not be read/);
  assert.match(blind.output, /No restore was sent/);

  // Something else moved the plugin meanwhile: do not install over it.
  const elsewhere = fixture(t, (s) => {
    s.bb.install = () => {
      s.bb.plugins[0] = s.entry("sample", path.join(s.base, "third"));
      return { status: 0, stdout: "" };
    };
  });
  assert.equal(elsewhere.code, exit.unverified);
  assert.deepEqual(elsewhere.installs, [elsewhere.artifact]);
  assert.match(elsewhere.receipt.primaryError, /neither path/);
});

test("a restore that does not take is reported with the primary failure kept, and is not retried", (t) => {
  const stuck = (s) => {
    s.bb.install = (target) => {
      if (target === s.artifact) {
        s.bb.plugins[0] = s.entry("sample", s.artifact);
        return { status: 0, stdout: "" };
      }
      return { status: 1, stdout: "" };
    };
  };
  const f = fixture(t, stuck);
  assert.equal(f.code, exit.unverified);
  assert.deepEqual(f.installs, [f.artifact, f.original]);
  assert.equal(f.receipt.primaryError, null);
  assert.match(f.receipt.restoreError, /restore command \(exit 1\)/);
  assert.equal(f.receipt.final.rootDir, f.artifact);
  assert.match(f.output, /sent once and is not retried/);

  // A probe failure and a restore failure are both kept.
  const both = fixture(t, (s) => {
    stuck(s);
    s.bb.probe = () => ({ status: 3, stdout: "" });
  });
  assert.equal(both.code, exit.unverified);
  assert.match(both.receipt.primaryError, /probe command failed/);
  assert.match(both.receipt.restoreError, /restore command \(exit 1\)/);
  assert.match(both.output, /probe command failed/);
});

test("a plugin that moves but is not running, or a failed probe, fails and is still restored", (t) => {
  const stopped = fixture(t, (s) => {
    s.bb.install = (target) => {
      s.bb.plugins[0] = s.entry(
        "sample",
        target,
        target === s.artifact ? { status: "error" } : {},
      );
      return { status: 0, stdout: "" };
    };
  });
  assert.equal(stopped.code, exit.failed);
  assert.deepEqual(stopped.installs, [stopped.artifact, stopped.original]);
  assert.match(stopped.receipt.primaryError, /is error, not running/);
  // No probe is sent to a plugin that did not start.
  assert.equal(stopped.receipt.probe, null);
  assert.equal(stopped.receipt.final.rootDir, stopped.original);

  const probe = fixture(t, (s) => {
    s.bb.probe = () => ({ status: 2, stdout: "" });
  });
  assert.equal(probe.code, exit.failed);
  assert.deepEqual(probe.installs, [probe.artifact, probe.original]);
  assert.equal(probe.receipt.final.rootDir, probe.original);
  assert.match(probe.output, /original install is running again/);
});

test("a receipt that cannot be written, or a crash as the install is sent, still ends with the plugin moved back", (t) => {
  const unwritable = fixture(t, (s) => {
    const move = s.bb.install;
    s.bb.install = (target) => {
      // The receipt's directory goes away while the install runs.
      if (target === s.artifact)
        rmSync(s.receiptDirectory, { recursive: true });
      return move(target);
    };
  });
  assert.deepEqual(unwritable.installs, [
    unwritable.artifact,
    unwritable.original,
  ]);
  assert.equal(unwritable.bb.plugins[0].rootDir, unwritable.original);
  assert.equal(unwritable.code, exit.passed);
  assert.match(unwritable.output, /could not write the receipt/);
  // The receipt is printed instead, so the record is not lost.
  assert.match(unwritable.output, /"outcome": "passed"/);

  const crashed = fixture(t, (s) => {
    const move = s.bb.install;
    s.bb.install = (target) => {
      const result = move(target);
      if (target === s.artifact) throw new Error("spawn EPIPE");
      return result;
    };
  });
  assert.deepEqual(crashed.installs, [crashed.artifact, crashed.original]);
  assert.equal(crashed.code, exit.failed);
  assert.match(crashed.receipt.primaryError, /load-check failed: spawn EPIPE/);
  assert.equal(crashed.receipt.final.rootDir, crashed.original);

  // A crash as the install is sent, with the plugin's state unreadable after.
  const lost = fixture(t, (s) => {
    s.bb.install = () => {
      s.bb.listReadable = false;
      throw new Error("spawn EPIPE");
    };
  });
  assert.equal(lost.code, exit.unverified);
  assert.deepEqual(lost.installs, [lost.artifact]);
});

test("a script error after the move still restores, and another plugin changing is noted", (t) => {
  const thrown = fixture(t, (s) => {
    s.bb.probe = () => {
      throw new Error("probe spawn exploded");
    };
  });
  assert.equal(thrown.code, exit.failed);
  assert.deepEqual(thrown.installs, [thrown.artifact, thrown.original]);
  assert.match(thrown.receipt.primaryError, /load-check failed: probe spawn/);
  assert.equal(thrown.receipt.final.rootDir, thrown.original);

  const neighbour = fixture(t, (s) => {
    s.bb.probe = () => {
      s.bb.plugins[1] = { ...s.bb.plugins[1], status: "error" };
      return { status: 0, stdout: "" };
    };
  });
  assert.equal(neighbour.code, exit.passed);
  assert.equal(neighbour.receipt.othersUnchanged, false);
  assert.match(neighbour.output, /Another plugin's listing changed/);
});
