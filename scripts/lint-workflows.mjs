import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exitCode } from "./verify.mjs";

export function lintWorkflows({
  version,
  cwd,
  run = spawnSync,
  log = console.log,
}) {
  const probe = run("actionlint", ["-version"], { cwd, encoding: "utf8" });
  const actual = probe.stdout?.trim().split("\n")[0].replace(/^v/, "");
  if (exitCode(probe) !== 0 || actual !== version) {
    log(
      `Workflow lint requires actionlint ${version}; found ${actual || "unavailable"}. Install the pinned version on PATH as documented in docs/dev/verification.md. No tools were installed.`,
    );
    return 1;
  }
  const files = run(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      ":(glob).github/workflows/*.yml",
      ":(glob).github/workflows/*.yaml",
    ],
    { cwd, encoding: "utf8" },
  );
  if (exitCode(files) !== 0) {
    log(
      files.error?.message ||
        files.stderr ||
        "Unable to list tracked workflows.",
    );
    return exitCode(files);
  }
  const paths = files.stdout.split("\0").filter(Boolean);
  if (paths.length === 0) {
    log(
      "No tracked .github/workflows YAML files found; stage new workflows before verification.",
    );
    return 1;
  }
  log(`actionlint ${actual}: ${paths.length} tracked workflows`);
  // Optional host-installed analyzers must not change local/CI gate behavior.
  const result = run("actionlint", ["-shellcheck=", "-pyflakes=", ...paths], {
    cwd,
    stdio: "inherit",
  });
  if (result.error) log(result.error.message);
  return exitCode(result);
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  process.exitCode = lintWorkflows({
    version: readFileSync(new URL(".actionlint-version", root), "utf8").trim(),
    cwd: fileURLToPath(root),
  });
}
