import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { modelConfigSchema, parseRequest } from "../contracts.ts";
import { createModelService } from "../models.ts";
import { openJudgeStorage, PersistenceError } from "../storage.ts";
import { InferenceService } from "../inference.ts";
import { publicConnectionIdentity } from "../connections.ts";
import { workersAI, WORKERS_LIMITS } from "./workers-ai.ts";

const questions = parseRequest({
  model: "fixture",
  state: null,
  questions: {
    q: { type: "noul", instructions: "Is the fixture public?" },
    choice: {
      type: "choice",
      instructions: "Route",
      criteria: { a: null, b: "B" },
    },
    score: { type: "score", instructions: "Impact", criteria: ["low", "high"] },
  },
}).questions;
const result = {
  model: "cf-provider-fixture",
  answers: {
    q: { type: "noul", noul: 0.8 },
    choice: {
      type: "choice",
      choice: "a",
      confidence: 0.8,
      probabilities: { a: 0.7, b: 0.3 },
    },
    score: {
      type: "score",
      score: 0.25,
      confidence: 0.7,
      legend: { "0": "low", "1": "high" },
      probabilities: { "0": 0.75, "1": 0.25 },
    },
  },
};
const envelope = { success: true, result, errors: [], messages: [] };
test("both selectors normalize bounded context diagnostics on HTTP400/422 before envelope rejection", async () => {
  for (const model of ["clef", "clef-flash"])
    for (const status of [400, 422])
      for (const field of ["errors", "messages"]) {
        for (const context of [true, false]) {
          const diagnostic = context
            ? {
                code: "context_length_exceeded",
                message: "Context window exceeded; private body",
              }
            : { code: 1, message: "Unrelated private failure" };
          const response = await workersAI({
            ...options(model),
            fetcher: async () =>
              Response.json(
                { ...envelope, success: false, [field]: [diagnostic] },
                { status },
              ),
          });
          assert.equal(response.status, "unavailable");
          if (response.status === "unavailable") {
            assert.equal(response.reason, context ? "too_large" : "error");
            assert.equal(
              response.code,
              context ? "provider_context_limit" : `http_${status}`,
            );
          }
          assert.ok(!JSON.stringify(response).includes("private"));
        }
      }
});
function options(model = "clef") {
  return {
    model: modelConfigSchema.parse({
      id: "cf",
      connection: "cloudflare",
      model,
    }),
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/cloudflare/${model}`,
    credential: "dummy-cf",
    questions,
    state: { text: "public fixture" },
    signals: [],
    deadlineAt: performance.now() + 2000,
  };
}

test("each selector routes to its own account endpoint and preserves the typed provider result", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: {
      cloudflareAccountId: "a".repeat(32),
      cloudflareApiToken: "dummy-cf",
    },
  });
  try {
    const models = await createModelService(bb, openJudgeStorage(bb.storage));
    let selected = "clef";
    const inference = new InferenceService(models, async (url, init) => {
      assert.equal(url, options(selected).endpoint);
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer dummy-cf",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: selected,
        state: { text: "public fixture" },
        questions,
      });
      return Response.json(envelope);
    });
    let fingerprint = "";
    for (selected of ["clef", "clef-flash"]) {
      models.save({ id: "cf", connection: "cloudflare", model: selected });
      models.setDefault("cf");
      const answer = await inference.ask({
        questions,
        state: { text: "public fixture" },
        selection: { sensitive: false },
      });
      assert.equal(answer.result.status, "ran");
      if (answer.result.status === "ran") {
        assert.deepEqual(answer.result.answers, result.answers);
        assert.equal(answer.result.providerModel, "cf-provider-fixture");
        assert.equal(answer.result.inputTokens, null);
      }
      assert.notEqual(answer.resolvedModel?.fingerprint, fingerprint);
      fingerprint = answer.resolvedModel!.fingerprint;
    }
    await harness.behavior.setSettings({ cloudflareAccountId: "b".repeat(32) });
    const changed = await models.resolve({ sensitive: false });
    assert.ok(changed.ok);
    assert.notEqual(changed.identity.fingerprint, fingerprint);
    const publicIdentity = publicConnectionIdentity(changed.model, {
      typesafeApiKey: undefined,
      customApiKey: undefined,
      cloudflareAccountId: "b".repeat(32),
      cloudflareApiToken: "dummy-cf",
      customBaseUrl: "",
    });
    assert.equal(publicIdentity.accountId, "b".repeat(32));
    assert.ok(publicIdentity.endpoint?.endsWith("/clef-flash"));
    assert.ok(
      !JSON.stringify([publicIdentity, changed.identity]).includes("dummy-cf"),
    );
    inference.dispose();
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("HTTP200 failure envelopes and diagnostics never become successful judgments", async () => {
  for (const [message, reason, code] of [
    ["Authentication failed; private body", "error", "authentication_failed"],
    ["Rate limit exceeded", "error", "rate_limited"],
    ["Context window exceeded", "too_large", "provider_context_limit"],
    ["Unknown model", "error", "unsupported_model"],
    ["private provider failure", "error", "provider_error"],
  ] as const) {
    for (const field of ["errors", "messages"]) {
      const response = await workersAI({
        ...options(),
        fetcher: async () =>
          Response.json({
            ...envelope,
            success: false,
            [field]: [{ code: 1, message }],
          }),
      });
      assert.equal(response.status, "unavailable");
      if (response.status === "unavailable") {
        assert.equal(response.reason, reason);
        assert.equal(response.code, code);
      }
      assert.ok(!JSON.stringify(response).includes("private"));
    }
  }
  const errorDespiteSuccess = await workersAI({
    ...options(),
    fetcher: async () =>
      Response.json({ ...envelope, errors: [{ code: 1, message: "failure" }] }),
  });
  assert.equal(errorDespiteSuccess.status, "unavailable");
  const notice = await workersAI({
    ...options(),
    fetcher: async () =>
      Response.json({
        ...envelope,
        messages: [{ code: 1, message: "notice" }],
      }),
  });
  assert.equal(notice.status, "ran");
});

test("malformed envelopes, partial answers and context-full results fail; absent/null usage is accepted", async () => {
  for (const bad of [
    { result },
    { ...envelope, success: "true" },
    { ...envelope, errors: ["error"] },
    { ...envelope, result: null },
    { ...envelope, result: { model: "cf", answers: { q: result.answers.q } } },
    {
      ...envelope,
      result: {
        ...result,
        answers: { ...result.answers, q: { type: "noul", noul: 2 } },
      },
    },
  ]) {
    const response = await workersAI({
      ...options(),
      fetcher: async () => Response.json(bad),
    });
    assert.equal(
      response.status === "unavailable" && response.reason,
      "invalid_response",
    );
  }
  for (const model of ["clef", "clef-flash"] as const) {
    const full = await workersAI({
      ...options(model),
      fetcher: async () =>
        Response.json({
          ...envelope,
          result: {
            ...result,
            usage: { input_tokens: WORKERS_LIMITS[model].contextTokens },
          },
        }),
    });
    assert.equal(full.status === "unavailable" && full.reason, "too_large");
  }
  const unknownUsage = await workersAI({
    ...options(),
    fetcher: async () =>
      Response.json({
        ...envelope,
        result: {
          ...result,
          usage: { input_tokens: null, output_tokens: null },
        },
      }),
  });
  assert.equal(unknownUsage.status === "ran" && unknownUsage.inputTokens, null);
});

test("separate Flash limits, ID bounds and unsupported models/modalities reject before dispatch", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(envelope);
  };
  const state = { text: "x".repeat(17 * 1024) };
  const flash = await workersAI({ ...options("clef-flash"), state, fetcher });
  assert.equal(flash.status === "unavailable" && flash.reason, "too_large");
  assert.equal(calls, 0);
  assert.equal(
    (await workersAI({ ...options(), state, fetcher })).status,
    "ran",
  );
  assert.equal(calls, 1);
  const longId = await workersAI({
    ...options(),
    questions: { ["q".repeat(101)]: questions.q! },
    fetcher,
  });
  assert.equal(
    longId.status === "unavailable" && longId.code,
    "provider_question_id_limit",
  );
  assert.equal(calls, 1);
  assert.throws(() => options("unsupported"), /unsupported_model/);
  assert.throws(() =>
    parseRequest({
      model: "clef",
      state: null,
      questions,
      images: ["deferred"],
    }),
  );
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const repo = openJudgeStorage(bb.storage);
    repo.saveModel(options().model);
    bb.storage
      .database()
      .prepare("UPDATE models SET config_json = ?")
      .run(JSON.stringify({ ...options().model, model: "../../unsupported" }));
    assert.throws(() => repo.getModel("cf"), PersistenceError);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("Workers AI shares sanitized HTTP/size/deadline and privacy boundaries", async () => {
  for (const status of [401, 429]) {
    const response = await workersAI({
      ...options(),
      fetcher: async () => new Response("private body", { status }),
    });
    assert.equal(
      response.status === "unavailable" && response.code,
      status === 401 ? "authentication_failed" : "rate_limited",
    );
  }
  const large = await workersAI({
    ...options(),
    model: { ...options().model, maxResponseBytes: 100 },
    fetcher: async () => Response.json(envelope),
  });
  assert.equal(large.status === "unavailable" && large.reason, "too_large");
  const expired = await workersAI({
    ...options(),
    deadlineAt: performance.now() - 1,
    fetcher: async () => {
      throw new Error("must not dispatch");
    },
  });
  assert.equal(expired.status === "unavailable" && expired.reason, "budget");
  const timeout = await workersAI({
    ...options(),
    model: { ...options().model, timeoutMs: 10 },
    fetcher: async () => new Promise<Response>(() => {}),
  });
  assert.equal(timeout.status === "unavailable" && timeout.reason, "timeout");
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: {
      cloudflareAccountId: "a".repeat(32),
      cloudflareApiToken: "dummy",
    },
  });
  try {
    const models = await createModelService(bb, openJudgeStorage(bb.storage));
    models.save(options().model);
    models.setDefault("cf");
    let calls = 0;
    const inference = new InferenceService(models, async () => {
      calls++;
      return Response.json(envelope);
    });
    const denied = await inference.ask({
      questions,
      state: { text: "fixture" },
      selection: { sensitive: true },
    });
    assert.equal(
      denied.result.status === "unavailable" && denied.result.reason,
      "private_not_allowed",
    );
    assert.equal(calls, 0);
    inference.dispose();
  } finally {
    await harness.lifecycle.dispose();
  }
});
