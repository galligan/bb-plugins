import assert from "node:assert/strict";
import { test } from "node:test";
import { gates, verify } from "./verify.mjs";

function fixture({
  bunVersion = "1.3.14",
  node = { version: "24.1.0", path: "/node/bin/node", bun: false },
  failure,
  probeFailure,
} = {}) {
  const calls = [];
  const lines = [];
  const code = verify({
    packageManager: "bun@1.3.14",
    nodePolicy: "24",
    bun: { version: bunVersion, path: "/bun/bin/bun" },
    env: { PATH: "/other/bin" },
    log: (line) => lines.push(line),
    run: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "node")
        return probeFailure ?? { status: 0, stdout: JSON.stringify(node) };
      return args[1] === "lint" && failure ? failure : { status: 0 };
    },
  });
  return { code, calls, output: lines.join("\n") };
}

test("runs existing gates in order using the preflight runtimes and reports exclusions", () => {
  const f = fixture();
  assert.equal(f.code, 0);
  assert.deepEqual(
    f.calls.slice(1).map((c) => c.args),
    gates.map((gate) => ["run", gate]),
  );
  for (const call of f.calls.slice(1)) {
    assert.equal(call.command, "/bun/bin/bun");
    assert.equal(call.options.env.PATH, "/node/bin:/bun/bin:/other/bin");
  }
  assert.match(f.output, /Bun: 1.3.14 \(\/bun\/bin\/bun\)/);
  assert.match(f.output, /Node: 24.1.0 \(\/node\/bin\/node\)/);
  assert.match(f.output, /build: passed/);
  assert.match(f.output, /Excluded: Linear/);
});

for (const [name, options] of Object.entries({
  "Bun mismatch": { bunVersion: "1.4.4" },
  "Node mismatch": { node: { version: "26.0.0", path: "/node", bun: false } },
  "Bun posing as Node": {
    node: { version: "24.0.0", path: "/bun", bun: true },
  },
  "missing Node": {
    probeFailure: { status: null, error: new Error("ENOENT") },
  },
  "invalid shim output": { probeFailure: { status: 0, stdout: "not JSON" } },
})) {
  test(`${name} fails before gates with remediation`, () => {
    const f = fixture(options);
    assert.equal(f.code, 1);
    assert.equal(f.calls.length, 1);
    assert.match(f.output, /Select Bun 1.3.14 and real Node 24.x/);
    for (const gate of gates) assert.ok(f.output.includes(`${gate}: not-run`));
  });
}

for (const [failure, expected] of [
  [{ status: 17 }, 17],
  [{ status: null, signal: "SIGTERM" }, 143],
  [{ status: null, error: new Error("spawn failed") }, 1],
]) {
  test(`failed gate preserves exit ${expected} and skips subsequent gates`, () => {
    const f = fixture({ failure });
    assert.equal(f.code, expected);
    assert.equal(f.calls.length, 3);
    assert.match(f.output, /format:check: passed/);
    assert.ok(f.output.includes(`lint: failed (exit ${expected})`));
    assert.match(f.output, /test: not-run/);
  });
}

test("CI consumes the same runtime policy and verification entry point", async () => {
  const { readFileSync } = await import("node:fs");
  const { YAML } = await import("bun");
  const steps = YAML.parse(
    readFileSync(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  ).jobs.verify.steps;
  assert.equal(
    steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun@")).with[
      "bun-version-file"
    ],
    "package.json",
  );
  assert.equal(
    steps.find((s) => s.uses?.startsWith("actions/setup-node@")).with[
      "node-version-file"
    ],
    ".node-version",
  );
  assert.ok(steps.some((s) => s.run === "bun run verify"));
  assert.ok(
    !steps.some((s) => gates.some((gate) => s.run === `bun run ${gate}`)),
  );
});
