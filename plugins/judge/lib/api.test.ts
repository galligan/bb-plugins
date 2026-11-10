import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import judge from "../server.ts";
import { JudgeApi, registerRpc } from "./api.ts";
import { registerCli } from "./cli.ts";
import { createModelService } from "./models.ts";
import { openJudgeStorage, PersistenceError } from "./storage.ts";
import { rpcContract } from "./api-contract.ts";
import { parseVerdict } from "./results.ts";

const questions = {
  main: { type: "noul", instructions: "Is publicSynthetic true?" },
};
const ask = { state: { publicSynthetic: true }, questions, notPrivate: true };
const response = {
  model: "fixture-version",
  answers: { main: { type: "noul", noul: 0.99 } },
};

async function setup(
  fetcher: typeof fetch = async () => Response.json(response),
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { typesafeApiKey: "dummy-secret-only" },
  });
  const repository = openJudgeStorage(bb.storage);
  const models = await createModelService(bb, repository);
  const api = new JudgeApi(models, repository, fetcher);
  bb.onDispose(() => api.dispose());
  registerRpc(bb, api);
  registerCli(bb, api);
  return { bb, harness, repository, api };
}

test("factory remains inert and every command/group exposes help and declared JSON errors", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("offline");
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    await judge(bb);
    for (const command of [
      [],
      ["models"],
      ["ask"],
      ["models", "list"],
      ["models", "add"],
      ["models", "default"],
      ["models", "check"],
      ["log"],
    ]) {
      const help = await harness.behavior.runCli([...command, "--help"]);
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /judge/);
    }
    for (const args of [
      ["ask", "--json"],
      ["models", "add", "m", "--json"],
      ["ask", "--state", "{}", "--noul", "q", "--unknown", "--json"],
      ["ask", "--state", "{}", "--noul", "q", "--questions", "{}", "--json"],
      ["log", "--limit", "101", "--json"],
      ["models", "check", "m", "--not-private", "--json"],
    ]) {
      const result = await harness.behavior.runCli(args);
      assert.equal(result.exitCode, 1);
      assert.equal(JSON.parse(result.stdout).ok, false);
    }
    const missing = await harness.behavior.runCli([
      "models",
      "add",
      "m",
      "--json",
    ]);
    assert.match(missing.stderr, /--connection/);
    assert.match(missing.stderr, /--model/);
    assert.equal(network, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("model setup, defaults and sanitized readiness share CLI/RPC services without dispatch", async () => {
  let network = 0;
  const { harness } = await setup(async (_url, options) => {
    network++;
    const body = JSON.parse(String(options?.body));
    return Response.json(
      Object.hasOwn(body.questions, "ready")
        ? {
            model: "fixture-version",
            answers: { ready: { type: "noul", noul: 1 } },
          }
        : response,
    );
  });
  try {
    const add = await harness.behavior.runCli([
      "models",
      "add",
      "jev",
      "--connection",
      "typesafe",
      "--model",
      "fixture",
      "--json",
    ]);
    assert.equal(add.exitCode, 0);
    assert.equal(JSON.parse(add.stdout).allowPrivate, false);
    assert.equal(
      (await harness.behavior.runCli(["models", "default", "jev", "--json"]))
        .exitCode,
      0,
    );
    const ready = await harness.behavior.callRpc("models.check", { id: "jev" });
    assert.deepEqual(ready, {
      modelId: "jev",
      status: "configured",
      code: "ready",
      tested: false,
      latencyMs: null,
      nextAction:
        "Run an explicit synthetic model check to verify connectivity; saving settings does not make a request.",
    });
    assert.equal(network, 0);
    const probe = (await harness.behavior.callRpc("models.check", {
      id: "jev",
      probe: true,
    })) as { tested: boolean; status: string };
    assert.equal(probe.tested, true);
    assert.equal(probe.status, "reachable");
    assert.equal(network, 1);
    assert.ok(
      !JSON.stringify([ready, probe, harness.logEntries]).includes(
        "dummy-secret",
      ),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("explicit asks persist typed outages and success, enforce private-by-default, and retain provider version", async () => {
  let calls = 0;
  const { harness, repository, api } = await setup(async () => {
    calls++;
    return Response.json(response);
  });
  try {
    const missing = parseVerdict(await harness.behavior.callRpc("ask", ask));
    assert.equal(missing.steps.main?.status, "unavailable");
    api.models.save({ id: "jev", connection: "typesafe", model: "fixture" });
    api.models.setDefault("jev");
    const denied = parseVerdict(
      await harness.behavior.callRpc("ask", { ...ask, notPrivate: false }),
    );
    assert.deepEqual(denied.steps.main, {
      status: "unavailable",
      reason: "private_not_allowed",
      code: "private_model_required",
    });
    assert.equal(calls, 0);
    const cli = await harness.behavior.runCli([
      "ask",
      "--state",
      JSON.stringify(ask.state),
      "--noul",
      "Is publicSynthetic true?",
      "--not-private",
      "--json",
    ]);
    assert.equal(cli.exitCode, 0);
    const verdict = parseVerdict(JSON.parse(cli.stdout));
    assert.equal(verdict.set, null);
    assert.equal(verdict.calibrated, false);
    assert.equal(verdict.complete, true);
    assert.equal(
      verdict.steps.main?.status === "ran" && verdict.steps.main.providerModel,
      "fixture-version",
    );
    assert.deepEqual(repository.getRun(verdict.runId), verdict);
    assert.deepEqual(
      await harness.behavior.callRpc("runs.get", { id: verdict.runId }),
      verdict,
    );
    assert.equal(repository.listRuns().length, 3);
    assert.ok(
      !JSON.stringify([repository.listRuns(), harness.logEntries]).includes(
        "publicSynthetic",
      ),
    );
    assert.equal(api.models.list()[0]!.allowPrivate, false);
    assert.equal(calls, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("invalid CLI JSON, malformed RPC batches and policies fail before network or storage", async () => {
  let calls = 0;
  const { harness, repository } = await setup(async () => {
    calls++;
    return Response.json(response);
  });
  try {
    for (const state of [
      "not-json-private-text",
      '"' + "x".repeat(270_000) + '"',
    ]) {
      const result = await harness.behavior.runCli([
        "ask",
        "--state",
        state,
        "--noul",
        "q",
        "--json",
      ]);
      assert.equal(result.exitCode, 1);
      assert.equal(JSON.parse(result.stdout).error.code, "invalid_input");
      assert.ok(!result.stdout.includes("not-json-private-text"));
    }
    for (const input of [
      { ...ask, source: "thread.lastMessage" },
      { ...ask, questions: { invalid: { type: "image" } } },
      { ...ask, notPrivate: "true" },
    ])
      await assert.rejects(harness.behavior.callRpc("ask", input));
    await assert.rejects(
      harness.behavior.callRpc("models.add", {
        id: "cf",
        model: "wrong",
        connection: "cloudflare",
      }),
    );
    assert.equal(calls, 0);
    assert.equal(repository.listRuns().length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("model/log pagination is bounded and cursors preserve equal-timestamp runs", async (t) => {
  const { harness, api } = await setup();
  try {
    for (const id of ["a", "b", "c"])
      api.models.save({ id, connection: "typesafe", model: "fixture" });
    const page = (await harness.behavior.callRpc("models.list", {
      limit: 2,
    })) as { next: string; models: { id: string }[] };
    assert.deepEqual(
      page.models.map((m) => m.id),
      ["a", "b"],
    );
    const tail = (await harness.behavior.callRpc("models.list", {
      limit: 2,
      after: page.next,
    })) as { models: { id: string }[] };
    assert.deepEqual(
      tail.models.map((m) => m.id),
      ["c"],
    );
    const now = Date.now();
    t.mock.method(Date, "now", () => now);
    for (let index = 0; index < 3; index++) await api.asks.ask(ask);
    const first = (await harness.behavior.callRpc("log", { limit: 2 })) as {
      runs: { runId: string }[];
      next: unknown;
    };
    const second = (await harness.behavior.callRpc("log", {
      limit: 2,
      before: first.next,
    })) as { runs: { runId: string }[]; next: unknown };
    assert.equal(
      new Set([...first.runs, ...second.runs].map((r) => r.runId)).size,
      3,
    );
    assert.equal(second.next, null);
    const terminal = (await harness.behavior.callRpc("log", { limit: 3 })) as {
      runs: unknown[];
      next: unknown;
    };
    assert.equal(terminal.runs.length, 3);
    assert.equal(terminal.next, null);
    assert.ok(!JSON.stringify(first).includes("steps"));
    for (const limit of [0, 101, 1.5]) {
      await assert.rejects(harness.behavior.callRpc("log", { limit }));
      await assert.rejects(harness.behavior.callRpc("models.list", { limit }));
    }
    await assert.rejects(
      harness.behavior.callRpc("log", {
        before: { startedAt: -1, runId: "x" },
      }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("cancelled probes retain cancellation diagnostics and pre-abort never claims an attempt", async () => {
  for (const preabort of [true, false]) {
    const caller = new AbortController();
    let calls = 0;
    let upstreamSignal: AbortSignal | undefined;
    const { harness, api } = await setup(async (_url, options) => {
      calls++;
      upstreamSignal = options?.signal ?? undefined;
      queueMicrotask(() => caller.abort());
      return new Promise<Response>(() => {});
    });
    try {
      api.models.save({ id: "jev", connection: "typesafe", model: "fixture" });
      if (preabort) caller.abort();
      const result = await harness.behavior.runCli(
        ["models", "check", "jev", "--probe", "--json"],
        { signal: caller.signal },
      );
      assert.equal(result.exitCode, 0);
      const diagnostic = JSON.parse(result.stdout);
      assert.equal(diagnostic.status, "cancelled");
      assert.equal(diagnostic.code, "cancelled");
      assert.equal(diagnostic.tested, !preabort);
      assert.equal(diagnostic.latencyMs === null, preabort);
      assert.match(diagnostic.nextAction, /cancelled/);
      assert.equal(calls, preabort ? 0 : 1);
      if (!preabort) assert.equal(upstreamSignal?.aborted, true);
    } finally {
      await harness.lifecycle.dispose();
    }
  }
});

test("RPC rejects invalid outputs and storage failure returns no successful logged verdict", async (t) => {
  const { harness, api, repository } = await setup();
  try {
    t.mock.method(api, "list", () => ({
      models: [],
      defaults: { defaultId: null, privateId: null },
      next: null,
      secret: "must-reject",
    }));
    await assert.rejects(
      harness.behavior.callRpc("models.list", {}),
      /output/i,
    );
    t.mock.method(repository, "saveRun", () => {
      throw new PersistenceError();
    });
    await assert.rejects(
      harness.behavior.callRpc("ask", ask),
      /persistence_failed/,
    );
    const result = await harness.behavior.runCli([
      "ask",
      "--state",
      "null",
      "--noul",
      "q",
      "--json",
    ]);
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "persistence_failed");
    assert.ok(!result.stdout.includes("runId"));
    assert.equal(repository.listRuns().length, 0);
    assert.ok(rpcContract.ask.output);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("CLI and RPC cancellation abort transports and persist cancellation rather than invented success", async () => {
  for (const surface of ["cli", "rpc"] as const) {
    const caller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const { harness, api, repository } = await setup(async (_url, options) => {
      upstreamSignal = options?.signal ?? undefined;
      queueMicrotask(() => caller.abort("sensitive caller reason"));
      return new Promise<Response>(() => {});
    });
    try {
      api.models.save({ id: "jev", model: "fixture", connection: "typesafe" });
      api.models.setDefault("jev");
      if (surface === "cli") {
        const result = await harness.behavior.runCli(
          ["ask", "--state", "null", "--noul", "q", "--not-private", "--json"],
          { signal: caller.signal },
        );
        assert.equal(result.exitCode, 0);
        assert.equal(parseVerdict(JSON.parse(result.stdout)).complete, false);
      } else {
        // A disconnected RPC caller may not receive the completed cancellation record.
        await harness.behavior
          .callRpc("ask", ask, { signal: caller.signal })
          .catch(() => {});
      }
      assert.equal(upstreamSignal?.aborted, true);
      const runs = repository.listRuns();
      assert.equal(runs.length, 1);
      assert.deepEqual(runs[0]!.steps.main, {
        status: "unavailable",
        reason: "cancelled",
        code: "cancelled",
      });
      assert.ok(!JSON.stringify(runs).includes("sensitive caller"));
    } finally {
      await harness.lifecycle.dispose();
    }
  }
});
