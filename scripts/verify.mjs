import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { constants } from "node:os";
import { readFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";

export const gates = [
  "format:check",
  "lint",
  "lint:workflows",
  "check",
  "test",
  "build",
];

export function exitCode(result) {
  return (
    result.status ??
    (result.signal ? 128 + (constants.signals[result.signal] ?? 0) : 1)
  );
}

export function verify({
  packageManager,
  nodePolicy,
  bun = { version: process.versions.bun, path: process.execPath },
  run = spawnSync,
  env = process.env,
  log = console.log,
}) {
  const states = new Map(gates.map((gate) => [gate, "not-run"]));
  const summary = (code) => {
    log("\nVerification summary:");
    for (const [gate, state] of states) log(`  ${gate}: ${state}`);
    return code;
  };
  const expectedBun = /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1];
  const expectedNode = /^\d+$/.test(nodePolicy) ? nodePolicy : undefined;
  log(
    `Bun: ${bun.version ?? "not Bun"} (${bun.path}); required ${expectedBun ?? packageManager}`,
  );
  const probe = run(
    "node",
    [
      "-p",
      "JSON.stringify({version:process.versions.node,path:process.execPath,bun:!!process.versions.bun})",
    ],
    { env, encoding: "utf8" },
  );
  let node;
  try {
    if (exitCode(probe) === 0) node = JSON.parse(probe.stdout);
  } catch {
    /* A shim may produce output other than Node's JSON. */
  }
  log(
    `Node: ${node?.version ?? "unavailable"} (${node?.path ?? "node on PATH"}); required ${nodePolicy}.x`,
  );
  if (
    !expectedBun ||
    !expectedNode ||
    bun.version !== expectedBun ||
    node?.bun !== false ||
    node.version?.split(".")[0] !== expectedNode ||
    !node.path
  ) {
    log(
      `Preflight failed. Select Bun ${expectedBun ?? packageManager} and real Node ${nodePolicy}.x on PATH, then rerun bun run verify. See docs/dev/verification.md. No runtimes were installed or changed.`,
    );
    return summary(1);
  }
  // Keep nested package scripts on the same runtimes that passed preflight.
  const gateEnv = {
    ...env,
    PATH: [dirname(node.path), dirname(bun.path), env.PATH]
      .filter(Boolean)
      .join(delimiter),
  };
  for (const gate of gates) {
    log(`\n> bun run ${gate}`);
    const result = run(bun.path, ["run", gate], {
      env: gateEnv,
      stdio: "inherit",
    });
    const code = exitCode(result);
    states.set(gate, code === 0 ? "passed" : `failed (exit ${code})`);
    if (code !== 0) {
      if (result.error) log(result.error.message);
      return summary(code);
    }
  }
  return summary(0);
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  process.chdir(fileURLToPath(root));
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  process.exitCode = verify({
    packageManager: pkg.packageManager,
    nodePolicy: readFileSync(new URL(".node-version", root), "utf8").trim(),
  });
}
