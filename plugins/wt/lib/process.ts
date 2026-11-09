import { execFile, spawn } from "node:child_process";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git in `cwd`. A non-zero exit resolves; a spawn failure or abort rejects. */
export function git(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        signal,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === "number") {
          resolve({ code: error.code, stdout, stderr });
        } else {
          reject(error);
        }
      },
    );
  });
}

export type ScriptResult = { ok: true } | { ok: false; reason: string };

const OUTPUT_LINE_MAX = 4096;

/**
 * Runs a shell script with bash in `cwd`, forwarding each output line. The
 * script gets its own process group so a timeout or abort stops its children.
 */
export function runScript(options: {
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput: (line: string) => void;
}): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", options.script], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stopReason: string | null = null;
    const stop = (reason: string) => {
      if (stopReason !== null || child.pid === undefined) return;
      stopReason = reason;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The group already exited.
      }
    };
    const timer = setTimeout(
      () =>
        stop(
          `timed out after ${String(Math.round(options.timeoutMs / 1000))}s`,
        ),
      options.timeoutMs,
    );
    const onAbort = () => stop("cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted === true) onAbort();

    const forward = (stream: NodeJS.ReadableStream) => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split(/\r?\n/u);
        pending = lines.pop() ?? "";
        for (const line of lines)
          options.onOutput(line.slice(0, OUTPUT_LINE_MAX));
      });
      stream.on("end", () => {
        if (pending !== "") options.onOutput(pending.slice(0, OUTPUT_LINE_MAX));
      });
    };
    forward(child.stdout);
    forward(child.stderr);

    const finish = (result: ScriptResult) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    child.on("error", (error) => finish({ ok: false, reason: error.message }));
    child.on("close", (code, killSignal) => {
      if (stopReason !== null) finish({ ok: false, reason: stopReason });
      else if (code === 0) finish({ ok: true });
      else if (code !== null)
        finish({ ok: false, reason: `exit code ${String(code)}` });
      else finish({ ok: false, reason: `killed by ${String(killSignal)}` });
    });
  });
}
