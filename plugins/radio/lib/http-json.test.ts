import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import radio from "../server.ts";
import { readHttpJson } from "./http-json.ts";
import { errorCode } from "./transmission-fixture.ts";
import { resultSchema } from "./surface-contract.ts";

function request(
  body: BodyInit,
  headers: HeadersInit = { "content-type": "application/json" },
) {
  return new Request("http://local.test/input", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

test("HTTP JSON bounds actual streamed bytes, validates UTF8/JSON and never echoes rejected content", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await readHttpJson(request('{"value":"é"}'), signal), {
    value: "é",
  });
  await assert.rejects(
    readHttpJson(request("{}", { "content-type": "text/plain" }), signal),
    errorCode("invalid_input"),
  );
  await assert.rejects(
    readHttpJson(request("not valid private-content"), signal),
    errorCode("invalid_input"),
  );
  await assert.rejects(
    readHttpJson(request(new Uint8Array([0xff])), signal),
    errorCode("invalid_input"),
  );
  await assert.rejects(
    readHttpJson(request('"ééé"'), signal, 6),
    errorCode("invalid_input"),
  );
  await assert.rejects(
    readHttpJson(
      request("{}", {
        "content-type": "application/json",
        "content-length": "99999",
      }),
      signal,
      16,
    ),
    errorCode("invalid_input"),
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(17)));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readHttpJson(request(stream), signal, 16),
    errorCode("invalid_input"),
  );
  assert.equal(cancelled, true);
});

test("a stalled JSON stream cancels on abort without waiting for another byte", async () => {
  const abort = new AbortController();
  let started!: () => void;
  const begin = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        started();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const pending = readHttpJson(request(stream), abort.signal);
  await begin;
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("plugin disposal cancels an in-flight HTTP body and does not start or record work", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "radio",
    agentSkillIds: ["radio"],
    settings: { trustedTestEnabled: true, trustedTestProject: "proj_local" },
  });
  radio(bb);
  let started!: () => void;
  const begin = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        started();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const pending = harness.behavior.fetchHttp("POST", "/trusted/register", {
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await begin;
  await harness.lifecycle.dispose();
  const response = await pending;
  const result = resultSchema.parse(await response.json());
  assert.equal(response.status, 499);
  assert.equal(result.ok, false);
  assert.equal(cancelled, true);
  assert.equal(harness.inspection.sdk.callsTo("threads.send").length, 0);
  assert.equal(harness.inspection.sdk.callsTo("projects.get").length, 0);
});
