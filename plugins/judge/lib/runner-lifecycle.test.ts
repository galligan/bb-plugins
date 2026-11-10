import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  definition,
  fixtureHostOptions,
  setupRunner,
} from "./runner-fixtures.ts";
const setup = (fetcher?: typeof fetch) =>
  setupRunner(createFakePluginHost(fixtureHostOptions), fetcher);

test("expiry before context dispatch and caller pre-abort record unavailable without source/network calls", async (t) => {
  const h = await setup();
  try {
    let now = 100;
    t.mock.method(performance, "now", () => now);
    const get = h.api.sets.get.bind(h.api.sets);
    t.mock.method(h.api.sets, "get", (id: string) => {
      const set = get(id);
      now += 6000;
      return set;
    });
    const expired = await h.api.runner.run({
      id: "synthetic",
      threadId: "thread",
    });
    assert.deepEqual(expired.steps.screen, {
      status: "unavailable",
      reason: "budget",
      code: "budget",
    });
    assert.deepEqual(expired.steps.detail, {
      status: "skipped",
      reason: "upstream_unavailable",
    });
    const caller = new AbortController();
    caller.abort("private reason");
    const pre = await h.api.runner.run(
      { id: "synthetic", threadId: "thread" },
      caller.signal,
    );
    assert.equal(
      pre.steps.screen?.status === "unavailable" && pre.steps.screen.reason,
      "cancelled",
    );
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
    assert.equal(h.bodies.length, 0);
    assert.equal(h.repository.listRuns().length, 2);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("whole budget includes a hanging context read and a later source read; abort-ignoring SDK cannot dispatch afterward", async () => {
  for (const phase of ["context", "source"]) {
    const h = await setup();
    try {
      const set = definition();
      set.budgetMs = 150;
      h.api.sets.save(JSON.stringify(set));
      let upstream: AbortSignal | undefined;
      let release: (value: unknown) => void = () => {};
      h.harness.sdk.stub(
        phase === "context" ? "threads.get" : "threads.output",
        async (...args: unknown[]) => {
          upstream = (args[0] as { signal: AbortSignal }).signal;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      );
      const result = await h.api.runner.run({
        id: "synthetic",
        threadId: "thread",
      });
      const id = phase === "context" ? "screen" : "detail";
      assert.equal(result.complete, false);
      assert.deepEqual(result.outcomes, {});
      assert.equal(
        result.steps[id]?.status === "unavailable" && result.steps[id].reason,
        "budget",
      );
      assert.equal(upstream?.aborted, true);
      assert.equal(h.bodies.length, phase === "context" ? 0 : 1);
      const calls = h.harness.inspection.sdk.calls.length;
      release({ output: "late synthetic output" });
      await new Promise((r) => setImmediate(r));
      assert.equal(h.harness.inspection.sdk.calls.length, calls);
      assert.equal(h.bodies.length, phase === "context" ? 0 : 1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("per-request timeout and remaining whole budget keep distinct diagnostics", async () => {
  for (const reason of ["timeout", "budget"]) {
    let observed: AbortSignal | undefined;
    const h = await setup(async (_url, init) => {
      observed = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    try {
      const set = definition();
      set.budgetMs = reason === "budget" ? 30 : 1000;
      h.api.sets.save(JSON.stringify(set));
      h.api.models.save({
        id: "public",
        model: "fixture",
        connection: "typesafe",
        timeoutMs: reason === "timeout" ? 30 : 1000,
      });
      const result = await h.api.runner.run({
        id: "synthetic",
        threadId: "thread",
      });
      assert.equal(
        result.steps.screen?.status === "unavailable" &&
          result.steps.screen.reason,
        reason,
      );
      assert.equal(observed?.aborted, true);
      assert.equal(h.bodies.length, 1);
      assert.deepEqual(result.steps.detail, {
        status: "skipped",
        reason: "upstream_unavailable",
      });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("caller cancellation, disposal and configuration edits stop in-flight sources and later steps", async () => {
  for (const kind of ["caller", "dispose", "set", "model", "project"]) {
    const h = await setup();
    const caller = new AbortController();
    try {
      let enter: () => void = () => {};
      const entered = new Promise<void>((r) => {
        enter = r;
      });
      let observed: AbortSignal | undefined;
      h.harness.sdk.stub("threads.output", async (...args: unknown[]) => {
        observed = (args[0] as { signal: AbortSignal }).signal;
        enter();
        return new Promise(() => {});
      });
      const pending = h.api.runner.run(
        { id: "synthetic", threadId: "thread" },
        caller.signal,
      );
      await entered;
      if (kind === "caller") caller.abort("private cancellation");
      else if (kind === "dispose") h.api.dispose();
      else if (kind === "set")
        h.api.sets.save(
          JSON.stringify({ ...definition(), description: "changed" }),
        );
      else if (kind === "model")
        h.api.models.save({
          id: "public",
          model: "changed",
          connection: "typesafe",
        });
      else h.api.sets.project("project", false);
      const result = await pending;
      assert.equal(result.steps.screen?.status, "ran");
      assert.equal(
        result.steps.detail?.status === "unavailable" &&
          result.steps.detail.reason,
        "cancelled",
      );
      assert.equal(observed?.aborted, true);
      assert.deepEqual(result.outcomes, {});
      assert.equal(h.bodies.length, 1);
      assert.equal(h.repository.listRuns().length, 1);
      assert.ok(!JSON.stringify(result).includes("private cancellation"));
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("caller cancellation in both saved CLI and RPC aborts inference and records a single incomplete run", async () => {
  for (const surface of ["cli", "rpc"]) {
    const caller = new AbortController();
    let observed: AbortSignal | undefined;
    const h = await setup(async (_url, init) => {
      observed = init?.signal ?? undefined;
      queueMicrotask(() => caller.abort());
      return new Promise(() => {});
    });
    try {
      if (surface === "cli") {
        const result = await h.harness.behavior.runCli(
          ["ask", "synthetic", "--thread", "thread", "--json"],
          { signal: caller.signal },
        );
        assert.equal(result.exitCode, 0);
        assert.equal(JSON.parse(result.stdout).complete, false);
      } else
        await h.harness.behavior
          .callRpc(
            "run",
            { id: "synthetic", threadId: "thread" },
            { signal: caller.signal },
          )
          .catch(() => {});
      assert.equal(observed?.aborted, true);
      const runs = h.repository.listRuns();
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.complete, false);
      assert.deepEqual(runs[0]?.steps.detail, {
        status: "skipped",
        reason: "upstream_unavailable",
      });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  }
});

test("successful and failed runs release every deadline timer", async (t) => {
  const h = await setup();
  const active = new Set<ReturnType<typeof setTimeout>>();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  try {
    t.mock.method(
      globalThis,
      "setTimeout",
      (callback: () => void, ms: number) => {
        const timer = realSet(() => {
          active.delete(timer);
          callback();
        }, ms);
        active.add(timer);
        return timer;
      },
    );
    t.mock.method(
      globalThis,
      "clearTimeout",
      (timer: ReturnType<typeof setTimeout>) => {
        active.delete(timer);
        return realClear(timer);
      },
    );
    await h.api.runner.run({ id: "synthetic", threadId: "thread" });
    assert.equal(active.size, 0);
    h.harness.sdk.stub("threads.output", async () => {
      throw new Error("synthetic failure");
    });
    await h.api.runner.run({ id: "synthetic", threadId: "thread" });
    assert.equal(active.size, 0);
  } finally {
    for (const timer of active) realClear(timer);
    await h.harness.lifecycle.dispose();
  }
});
