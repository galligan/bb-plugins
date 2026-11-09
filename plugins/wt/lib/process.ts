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
const OUTPUT_LINES_MAX = 5000;
const KILL_GRACE_MS = 5000;
/** How long to wait for the pipes to close once the group has been SIGKILLed. */
const SETTLE_MS = 2000;

const running = new Set<() => void>();

/** SIGKILLs every script still running. For worker shutdown. */
export function killAllScripts(): void {
  for (const kill of running) kill();
}

/**
 * Runs a shell script with bash in `cwd`, forwarding each output line. The
 * script gets its own process group. A timeout or abort sends SIGTERM to the
 * group, then SIGKILL after a grace period, so the promise always settles.
 * Output is bounded: long lines are cut and only the first lines are forwarded.
 */
export function runScript(options: {
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput: (line: string) => void;
  killGraceMs?: number;
}): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", options.script], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const signalGroup = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, name);
      } catch {
        // The group already exited.
      }
    };

    const groupAlive = (): boolean => {
      if (child.pid === undefined) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    let settled = false;
    let stopReason: string | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;
    let goneTimer: NodeJS.Timeout | undefined;
    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      clearInterval(goneTimer);
      options.signal?.removeEventListener("abort", onAbort);
      running.delete(forceKill);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };
    const kill = (reason: string) => {
      signalGroup("SIGKILL");
      // A descendant that escaped the group can still hold the pipes open.
      settleTimer = setTimeout(() => finish({ ok: false, reason }), SETTLE_MS);
    };
    const stop = (reason: string) => {
      if (stopReason !== null) return;
      stopReason = reason;
      signalGroup("SIGTERM");
      // A stopped script is finished only when its whole group is gone. The
      // shell exiting, or its pipes closing, says nothing about its children.
      goneTimer = setInterval(() => {
        if (!groupAlive()) finish({ ok: false, reason });
      }, 50);
      killTimer = setTimeout(
        () => kill(reason),
        options.killGraceMs ?? KILL_GRACE_MS,
      );
    };
    const forceKill = () => {
      stopReason ??= "stopped with the worker";
      signalGroup("SIGKILL");
      finish({ ok: false, reason: stopReason });
    };
    running.add(forceKill);

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

    let forwarded = 0;
    const emit = (line: string) => {
      forwarded += 1;
      if (forwarded <= OUTPUT_LINES_MAX) {
        options.onOutput(line);
      } else if (forwarded === OUTPUT_LINES_MAX + 1) {
        options.onOutput(
          `[output truncated after ${String(OUTPUT_LINES_MAX)} lines]`,
        );
      }
    };
    const forward = (stream: NodeJS.ReadableStream) => {
      // `pending` never grows past OUTPUT_LINE_MAX, however long a line is.
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const parts = chunk.split(/\r?\n/u);
        parts.forEach((part, index) => {
          pending += part.slice(0, OUTPUT_LINE_MAX - pending.length);
          if (index < parts.length - 1) {
            emit(pending);
            pending = "";
          }
        });
      });
      stream.on("end", () => {
        if (pending !== "") emit(pending);
      });
    };
    forward(child.stdout);
    forward(child.stderr);

    child.on("error", (error) => finish({ ok: false, reason: error.message }));
    child.on("close", (code, killSignal) => {
      // Once stopping, `goneTimer` decides when this is over, not the shell.
      if (stopReason !== null) return;
      if (code === 0) finish({ ok: true });
      else if (code !== null)
        finish({ ok: false, reason: `exit code ${String(code)}` });
      else finish({ ok: false, reason: `killed by ${String(killSignal)}` });
    });
  });
}
