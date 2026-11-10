import { ValidationError } from "./json.ts";

export type AbortReason = "cancelled" | "timeout" | "budget";
export class OperationAborted extends Error {
  readonly reason: AbortReason;
  constructor(reason: AbortReason) {
    super(reason);
    this.reason = reason;
  }
}

/** Monotonic deadlines, with explicit cleanup even when a transport ignores abort. */
export class Deadline {
  private controller = new AbortController();
  private cleanup: (() => void)[] = [];
  private end: number;
  private deadlineAt: number;
  private reason: AbortReason | null = null;
  private closed = false;

  constructor(options: {
    signals?: (AbortSignal | undefined)[];
    deadlineAt: number;
    timeoutMs?: number;
  }) {
    if (
      !Number.isFinite(options.deadlineAt) ||
      (options.timeoutMs !== undefined &&
        (!Number.isFinite(options.timeoutMs) ||
          options.timeoutMs <= 0 ||
          options.timeoutMs > 30_000))
    )
      throw new ValidationError("invalid_deadline");
    this.deadlineAt = options.deadlineAt;
    this.end = Math.min(
      this.deadlineAt,
      options.timeoutMs === undefined
        ? Infinity
        : performance.now() + options.timeoutMs,
    );
    for (const signal of options.signals ?? []) {
      if (!signal) continue;
      const cancel = () => this.abort("cancelled");
      if (signal.aborted) cancel();
      else {
        signal.addEventListener("abort", cancel, { once: true });
        this.cleanup.push(() => signal.removeEventListener("abort", cancel));
      }
    }
    if (!this.signal.aborted) {
      if (this.end <= performance.now()) this.expire();
      else {
        const timer = setTimeout(
          () => this.expire(),
          Math.max(0, this.end - performance.now()),
        );
        this.cleanup.push(() => clearTimeout(timer));
      }
    }
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  private abort(reason: AbortReason): void {
    if (!this.signal.aborted) {
      this.reason = reason;
      this.controller.abort();
    }
  }
  private expire(): void {
    this.abort(this.deadlineAt <= this.end ? "budget" : "timeout");
  }
  assertActive(): void {
    if (!this.signal.aborted && performance.now() >= this.end) this.expire();
    if (this.closed || this.signal.aborted)
      throw new OperationAborted(this.reason ?? "cancelled");
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    let cancel: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(new OperationAborted(this.reason ?? "cancelled"));
      this.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          this.assertActive();
          return operation();
        }),
        aborted,
      ]);
      this.assertActive();
      return value;
    } finally {
      this.signal.removeEventListener("abort", cancel);
    }
  }
  close(): void {
    this.closed = true;
    for (const cleanup of this.cleanup.splice(0)) cleanup();
  }
}
