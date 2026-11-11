import assert from "node:assert/strict";
import { test } from "node:test";
import { modelConfigSchema, parseRequest } from "../contracts.ts";
import { systemOne } from "./systemone.ts";

const questions = parseRequest({
  model: "fixture",
  state: null,
  questions: {
    q: { type: "noul", instructions: { question: "Does text exist?" } },
    choice: {
      type: "choice",
      instructions: "Route",
      criteria: { a: "A", b: "B" },
    },
    score: { type: "score", instructions: "Impact", criteria: ["low", "high"] },
  },
}).questions;
const response = {
  model: "fixture-version-1",
  answers: {
    q: { type: "noul", noul: 0.8 },
    choice: {
      type: "choice",
      choice: "a",
      confidence: 0.9,
      probabilities: { a: 0.75, b: 0.25 },
    },
    score: {
      type: "score",
      score: 0.25,
      confidence: 0.8,
      probabilities: { "0": 0.75, "1": 0.25 },
      legend: { "0": "low", "1": "high" },
    },
  },
};
const base = {
  model: modelConfigSchema.parse({
    id: "fixture",
    connection: "typesafe",
    model: "fixture-alias",
  }),
  endpoint: "https://api.typesafe.ai/v1/systemone",
  credential: "dummy-only",
  questions,
  state: { text: "public fixture" },
  signals: [],
  deadlineAt: Infinity,
};
function options() {
  return { ...base, deadlineAt: performance.now() + 5000 };
}

test("nullable and partial documented usage preserves unknown input counts as null", async () => {
  for (const usage of [
    null,
    {},
    { output_tokens: 5 },
    { input_tokens: null },
    { input_tokens: null, output_tokens: null },
    { input_tokens: 0, output_tokens: null },
    { input_tokens: 12, output_tokens: null },
    { input_tokens: 12 },
  ]) {
    const result = await systemOne({
      ...options(),
      fetcher: async () => Response.json({ ...response, usage }),
    });
    assert.equal(result.status, "ran");
    if (result.status === "ran")
      assert.equal(result.inputTokens, usage?.input_tokens ?? null);
  }
});

test("System One exact POST/auth/body/redirect mapping preserves typed answers and provider identity", async () => {
  let calls = 0;
  const result = await systemOne({
    ...options(),
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, base.endpoint);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(init?.headers, {
        "content-type": "application/json",
        authorization: "Bearer dummy-only",
      });
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "fixture-alias",
        questions,
        state: base.state,
      });
      return Response.json(response);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ran");
  if (result.status === "ran") {
    assert.equal(result.providerModel, "fixture-version-1");
    assert.equal(result.inputTokens, null);
    assert.deepEqual(result.answers, response.answers);
  }
  const withUsage = await systemOne({
    ...options(),
    fetcher: async () =>
      Response.json({
        ...response,
        usage: { input_tokens: 12, output_tokens: 3 },
      }),
  });
  assert.equal(withUsage.status === "ran" && withUsage.inputTokens, 12);
});

test("custom compatible roots use optional auth without claiming generic local-server compatibility", async () => {
  for (const credential of [undefined, "dummy-custom"]) {
    const result = await systemOne({
      ...options(),
      endpoint: "http://localhost:12345/root/v1/systemone",
      credential,
      model: { ...base.model, connection: "custom" },
      fetcher: async (url, init) => {
        assert.equal(url, "http://localhost:12345/root/v1/systemone");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          credential ? `Bearer ${credential}` : null,
        );
        return Response.json(response);
      },
    });
    assert.equal(result.status, "ran");
  }
});

test("malformed batches/JSON/UTF8 are invalid responses; raw answer/error text never escapes", async () => {
  for (const bad of [
    { ...response, answers: {} },
    {
      ...response,
      answers: { ...response.answers, q: { type: "noul", noul: 2 } },
    },
    {
      ...response,
      answers: {
        ...response.answers,
        q: { type: "image", image: "private upstream text" },
      },
    },
    { ...response, usage: { input_tokens: "12" } },
    { ...response, extra: "private upstream text" },
  ]) {
    const result = await systemOne({
      ...options(),
      fetcher: async () => Response.json(bad),
    });
    assert.equal(
      result.status === "unavailable" && result.reason,
      "invalid_response",
    );
    assert.ok(!JSON.stringify(result).includes("private upstream"));
  }
  for (const body of ["not json", new Uint8Array([0xff, 0xfe])]) {
    const result = await systemOne({
      ...options(),
      fetcher: async () => new Response(body),
    });
    assert.equal(
      result.status === "unavailable" && result.reason,
      "invalid_response",
    );
  }
});

test("HTTP/auth/context failures are sanitized and never retried or redirected", async () => {
  for (const [status, body, reason, code] of [
    [401, "dummy-secret echoed", "error", "authentication_failed"],
    [403, "dummy-secret echoed", "error", "authentication_failed"],
    [500, "private HTML", "error", "http_500"],
    [429, "rate limit", "error", "rate_limited"],
    [302, "", "error", "redirect_rejected"],
    [422, "not JSON", "error", "http_422"],
    [413, "private state", "too_large", "provider_context_limit"],
    [
      400,
      JSON.stringify({
        error: { code: "context_length_exceeded", message: "private state" },
      }),
      "too_large",
      "provider_context_limit",
    ],
    [
      422,
      JSON.stringify({ error: { message: "Input exceeds context window" } }),
      "too_large",
      "provider_context_limit",
    ],
  ] as const) {
    let calls = 0;
    const result = await systemOne({
      ...options(),
      fetcher: async () => {
        calls++;
        return new Response(body, { status });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") {
      assert.equal(result.reason, reason);
      assert.equal(result.code, code);
    }
    assert.ok(!/private|dummy-secret/.test(JSON.stringify(result)));
  }
  const network = await systemOne({
    ...options(),
    fetcher: async () => {
      throw new Error("dummy-key and request-state");
    },
  });
  assert.equal(
    network.status === "unavailable" && network.code,
    "network_error",
  );
  assert.ok(!JSON.stringify(network).includes("dummy-key"));
});

test("request/question limits refuse before dispatch; response size is enforced on headers and streamed UTF8 bytes", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(response);
  };
  const bytes = await systemOne({
    ...options(),
    model: { ...base.model, maxRequestBytes: 100 },
    fetcher,
  });
  assert.equal(bytes.status === "unavailable" && bytes.reason, "too_large");
  const count = await systemOne({
    ...options(),
    model: { ...base.model, maxQuestions: 1 },
    fetcher,
  });
  assert.equal(
    count.status === "unavailable" && count.code,
    "model_question_limit",
  );
  assert.equal(calls, 0);
  let cancelled = 0;
  for (const advertised of [false, true]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("é".repeat(60)));
      },
      cancel() {
        cancelled++;
      },
    });
    const result = await systemOne({
      ...options(),
      model: { ...base.model, maxResponseBytes: 100 },
      fetcher: async () =>
        new Response(body, {
          headers: advertised ? { "content-length": "120" } : {},
        }),
    });
    assert.equal(
      result.status === "unavailable" && result.code,
      "response_bytes",
    );
  }
  assert.equal(cancelled, 2);
});

test("request timeout and whole budget bound both stalled dispatch and response streams", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  for (const stalledBody of [false, true]) {
    for (const budget of [false, true]) {
      let aborted = false;
      let bodyRead = false;
      now = 0;
      const expire = () => {
        now = 16;
        t.mock.timers.tick(16);
      };
      const result = await systemOne({
        ...options(),
        model: { ...base.model, timeoutMs: budget ? 2000 : 15 },
        deadlineAt: performance.now() + (budget ? 15 : 2000),
        fetcher: async (_, init) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          if (!stalledBody) {
            expire();
            return new Promise<Response>(() => {});
          }
          return new Response(
            new ReadableStream(
              {
                pull() {
                  bodyRead = true;
                  expire();
                  return new Promise(() => {});
                },
              },
              { highWaterMark: 0 },
            ),
          );
        },
      });
      assert.equal(
        result.status === "unavailable" && result.reason,
        budget ? "budget" : "timeout",
      );
      assert.equal(aborted, true);
      assert.equal(bodyRead, stalledBody);
    }
  }
});
