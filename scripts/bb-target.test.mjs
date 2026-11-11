import assert from "node:assert/strict";
import { test } from "node:test";
import { exit, target } from "./bb-target.mjs";

const DEV = "/Users/someone/.bb-dev/instance";
const args = (...forwarded) => [
  "--url",
  "http://127.0.0.1:26207",
  "--data-dir",
  DEV,
  "--",
  ...forwarded,
];

function fixture({
  argv = args("plugin", "list"),
  env = { PATH: "/bin" },
  status = { status: 0, stdout: JSON.stringify({ dataDir: DEV }) },
  forwarded = { status: 0 },
  links = {},
  // What `thread show <id> --json` answers on the instance.
  shown = { status: 1, stdout: "" },
} = {}) {
  const calls = [];
  const lines = [];
  const code = target({
    argv,
    env,
    home: "/Users/someone",
    // Stands in for the filesystem: only listed paths are symlinks.
    realpath: (file) => links[file] ?? file,
    log: (line) => lines.push(line),
    run: (command, commandArgs, options) => {
      calls.push({ command, args: commandArgs, options });
      if (calls.length === 1) return status;
      if (commandArgs[0] === "thread" && commandArgs[1] === "show") {
        return shown;
      }
      return forwarded;
    },
  });
  return { code, calls, output: lines.join("\n") };
}

test("verifies the instance's own data directory, then forwards the command to it", () => {
  const f = fixture({
    argv: [
      "--url",
      "http://127.0.0.1:26207/",
      "--data-dir",
      `${DEV}/`,
      "--daemon-port",
      "34207",
      "--",
      "plugin",
      "list",
      "--json",
    ],
    forwarded: { status: 7 },
  });
  assert.equal(f.code, 7, "returns the forwarded command's exit code");
  assert.deepEqual(
    f.calls.map((call) => [call.command, ...call.args]),
    [
      ["bb", "status", "--json"],
      ["bb", "plugin", "list", "--json"],
    ],
  );
  for (const call of f.calls)
    assert.deepEqual(call.options.env, {
      PATH: "/bin",
      BB_SERVER_URL: "http://127.0.0.1:26207",
      BB_DATA_DIR: DEV,
      BB_HOST_DAEMON_PORT: "34207",
    });
  assert.equal(f.calls[1].options.stdio, "inherit");
  assert.match(f.output, /http:\/\/127\.0\.0\.1:26207 serves .*instance\./);
});

test("drops every inherited BB variable so a thread's context cannot pick the target", () => {
  const f = fixture({
    env: {
      PATH: "/bin",
      HOME: "/Users/someone",
      BB_CLI: "/prod/bb",
      BB_THREAD_ID: "thr_prod",
      BB_ENVIRONMENT_ID: "env_prod",
      BB_PROJECT_ID: "proj_prod",
      BB_SERVER_URL: "http://127.0.0.1:38886",
      BB_HOST_DAEMON_PORT: "38887",
      BB_DATA_DIR: "/Users/someone/.bb",
      BB_THREAD_STORAGE: "/prod/storage",
    },
  });
  assert.equal(f.code, 0);
  for (const call of f.calls)
    assert.deepEqual(call.options.env, {
      PATH: "/bin",
      HOME: "/Users/someone",
      BB_SERVER_URL: "http://127.0.0.1:26207",
      BB_DATA_DIR: DEV,
    });
});

test("refuses the default server port on every host, before running anything", () => {
  for (const url of [
    "http://127.0.0.1:38886",
    "http://localhost:38886/",
    "http://LOCALHOST:38886",
    // A trailing dot is the same host, and no list of spellings is complete.
    "http://localhost.:38886",
    "http://[::1]:38886",
    "http://0.0.0.0:38886",
    "http://127.1:38886",
    "http://2130706433:38886",
    "http://0x7f.0.0.1:38886",
    "http://[::ffff:127.0.0.1]:38886",
    "http://bb.localhost:38886",
    "https://127.0.0.1:38886",
    // Names and addresses that can still be this machine.
    "http://my-mac.local:38886",
    "http://192.168.1.20:38886",
    "http://alias.example.test:38886",
  ]) {
    const f = fixture({
      argv: ["--url", url, "--data-dir", DEV, "--", "status"],
    });
    assert.equal(f.code, exit.refused, url);
    assert.deepEqual(f.calls, [], url);
    assert.match(f.output, /default BB server port/, url);
  }
  // Another port is accepted, subject to the identity check.
  assert.equal(fixture().code, 0);
});

test("refuses the default data directory in every spelling of its path", () => {
  for (const [dataDir, links] of [
    ["/Users/someone/.bb", {}],
    ["/Users/someone/.bb/", {}],
    ["/Users/someone/x/../.bb", {}],
    ["/Users/someone/.BB", { "/Users/someone/.BB": "/Users/someone/.bb" }],
    ["/tmp/link-to-bb", { "/tmp/link-to-bb": "/Users/someone/.bb" }],
  ]) {
    const f = fixture({
      argv: [
        "--url",
        "http://127.0.0.1:26207",
        "--data-dir",
        dataDir,
        "--",
        "status",
      ],
      links,
    });
    assert.equal(f.code, exit.refused, dataDir);
    assert.deepEqual(f.calls, [], dataDir);
    assert.match(f.output, /default BB data directory/, dataDir);
  }
});

test("forwards nothing when the instance at the URL is not the one expected", () => {
  // The URL answers, but it is the production instance on a forwarded port.
  const wrong = fixture({
    status: {
      status: 0,
      stdout: JSON.stringify({ dataDir: "/Users/someone/.bb" }),
    },
  });
  assert.equal(wrong.code, exit.refused);
  assert.equal(wrong.calls.length, 1);
  assert.match(wrong.output, /serves \/Users\/someone\/\.bb, not .*instance/);

  // The same directory under another spelling is the expected instance.
  const linked = fixture({
    status: { status: 0, stdout: JSON.stringify({ dataDir: "/private/dev" }) },
    links: { [DEV]: "/private/dev" },
  });
  assert.equal(linked.code, 0);
  assert.equal(linked.calls.length, 2);
});

test("forwards nothing when the instance cannot be identified", () => {
  for (const status of [
    { error: new Error("spawn bb ENOENT") },
    { status: 1, stdout: "" },
    { status: 0, stdout: "not json" },
    { status: 0, stdout: JSON.stringify({}) },
    { status: 0, stdout: JSON.stringify({ dataDir: null }) },
  ]) {
    const f = fixture({ status });
    assert.equal(f.code, exit.refused);
    assert.equal(f.calls.length, 1);
    assert.match(f.output, /Could not confirm which instance answers/);
  }
});

test("never prints the forwarded arguments", () => {
  const secret = "sk-not-a-real-secret";
  for (const overrides of [
    {},
    { status: { status: 1, stdout: "" } },
    {
      status: { status: 0, stdout: JSON.stringify({ dataDir: "/elsewhere" }) },
    },
    { forwarded: { error: new Error("spawn failed") } },
  ]) {
    const f = fixture({
      argv: args("settings", "set", "apiToken", secret),
      ...overrides,
    });
    assert.doesNotMatch(f.output, new RegExp(secret));
    assert.doesNotMatch(f.output, /apiToken/);
  }
});

test("an explicit CLI entry is used for both calls, under Node when it is a script", () => {
  const script = fixture({
    argv: [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--cli",
      "/src/bb/dist/bb.js",
      "--",
      "status",
    ],
  });
  assert.deepEqual(
    script.calls.map((call) => [call.command, ...call.args]),
    [
      ["node", "/src/bb/dist/bb.js", "status", "--json"],
      ["node", "/src/bb/dist/bb.js", "status"],
    ],
  );
  const binary = fixture({
    argv: [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--cli",
      "/opt/bb",
      "--",
      "status",
    ],
  });
  assert.deepEqual(
    binary.calls.map((call) => call.command),
    ["/opt/bb", "/opt/bb"],
  );
});

test("incomplete or malformed invocations print usage and run nothing", () => {
  for (const argv of [
    [],
    ["status"],
    ["--url", "http://127.0.0.1:26207", "--", "status"],
    ["--data-dir", DEV, "--", "status"],
    ["--url", "http://127.0.0.1:26207", "--data-dir", DEV],
    ["--url", "http://127.0.0.1:26207", "--data-dir", DEV, "--"],
    [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--unknown",
      "x",
      "--",
      "status",
    ],
    ["--url", "a", "--url", "b", "--data-dir", DEV, "--", "status"],
    ["--url", "not a url", "--data-dir", DEV, "--", "status"],
    ["--url", "file:///tmp/sock", "--data-dir", DEV, "--", "status"],
    [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--daemon-port",
      "x",
      "--",
      "status",
    ],
    [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--daemon-port",
      "65536",
      "--",
      "status",
    ],
    [
      "--url",
      "http://127.0.0.1:26207",
      "--data-dir",
      DEV,
      "--daemon-port",
      "0",
      "--",
      "status",
    ],
  ]) {
    const f = fixture({ argv });
    assert.equal(f.code, exit.usage, JSON.stringify(argv));
    assert.deepEqual(f.calls, []);
  }
});

const asThread = (...forwarded) => [
  "--url",
  "http://127.0.0.1:26207",
  "--data-dir",
  DEV,
  "--thread",
  "thr_fixture1",
  "--",
  ...forwarded,
];
const thread = (fields) => ({
  status: 0,
  stdout: JSON.stringify({
    thread: { id: "thr_fixture1", projectId: "proj_fixture1", ...fields },
  }),
});

test("--thread runs the command as a thread the instance confirms it has", () => {
  const f = fixture({
    argv: asThread("bbots", "report", "--token", "s3cret"),
    env: {
      PATH: "/bin",
      BB_THREAD_ID: "thr_inherited",
      BB_PROJECT_ID: "proj_inherited",
      BB_SERVER_URL: "http://127.0.0.1:38886",
    },
    shown: thread(),
  });
  assert.equal(f.code, 0, f.output);
  assert.deepEqual(
    f.calls.map((call) => call.args),
    [
      ["status", "--json"],
      ["thread", "show", "thr_fixture1", "--json"],
      ["bbots", "report", "--token", "s3cret"],
    ],
  );
  // The lookup itself runs as nobody; only the forwarded command is the thread.
  assert.equal(f.calls[1].options.env.BB_THREAD_ID, undefined);
  const env = f.calls[2].options.env;
  assert.equal(env.BB_THREAD_ID, "thr_fixture1");
  // The project is the thread's own, as in a real thread's shell.
  assert.equal(env.BB_PROJECT_ID, "proj_fixture1");
  assert.equal(env.BB_SERVER_URL, "http://127.0.0.1:26207");
  assert.match(f.output, /as thread thr_fixture1 in project proj_fixture1/);
  assert.doesNotMatch(f.output, /s3cret|--token|thr_inherited/);
});

test("--thread is refused, and nothing forwarded, when the instance does not have that thread", () => {
  for (const shown of [
    { status: 1, stdout: JSON.stringify({ ok: false }) },
    { error: new Error("spawn bb ENOENT") },
    { status: 0, stdout: "not json" },
    { status: 0, stdout: JSON.stringify({ thread: null }) },
    // The lookup failed, whatever it printed.
    { ...thread(), status: 1 },
    // Another thread answered, or one with no project.
    thread({ id: "thr_other" }),
    thread({ projectId: null }),
  ]) {
    const f = fixture({ argv: asThread("bbots", "report"), shown });
    assert.equal(f.code, exit.refused);
    assert.equal(f.calls.length, 2);
    assert.match(f.output, /has no thread thr_fixture1; nothing was forwarded/);
  }
});

test("--thread takes only a thread id, and is not looked up on an instance that failed its check", () => {
  for (const value of ["proj_fixture1", "thr_", "thr_a b", "../thr_x", ""]) {
    const f = fixture({
      argv: [
        "--url",
        "http://127.0.0.1:26207",
        "--data-dir",
        DEV,
        "--thread",
        value,
        "--",
        "status",
      ],
    });
    assert.equal(f.code, exit.usage, value);
    assert.deepEqual(f.calls, [], value);
  }
  const wrong = fixture({
    argv: asThread("bbots", "report"),
    status: { status: 0, stdout: JSON.stringify({ dataDir: "/elsewhere" }) },
    shown: thread(),
  });
  assert.equal(wrong.code, exit.refused);
  assert.equal(wrong.calls.length, 1);
});
