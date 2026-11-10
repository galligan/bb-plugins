# Transport verification

## System One / Jev / compatible custom endpoints

Checked 2026-11-10 against the official TypeSafe documentation through Context7 (`/typesafe-docs/typesafeai`):

- [HTTP API reference](https://github.com/typesafe-docs/typesafeai/blob/main/docs/09-api-reference.md): `/v1/systemone`, model/state/questions request, answer fields, usage and documented HTTP error statuses.
- [Endpoint/authentication cheat sheet](https://github.com/typesafe-docs/typesafeai/blob/main/docs/14-cheatsheet.md): POST, JSON, and Bearer API-key header.
- [Python response contract](https://github.com/typesafe-docs/typesafeai/blob/main/docs/reference/python/responses.md): usage counts independently permit omission or null; known input counts, including zero, remain numbers. Missing/null input usage is reported as `null`.
- [JavaScript builders](https://github.com/typesafe-docs/typesafeai/blob/main/docs/11-sdk-javascript.md): label-map choice criteria, ordered score rubric, structured entries and null support.
- [Structured instructions](https://github.com/typesafe-docs/typesafeai/blob/main/docs/04-primitives/advanced-structure.md): JSON instruction objects referencing named state.

`lib/transports/systemone.test.ts` records synthetic JSON fixtures derived from these schemas. They are not captured credentialed responses. They cover all three primitives, fractional scores and their rubric, missing usage, actual returned provider model identity, malformed batches, invalid JSON/UTF-8, HTTP/auth failures, context errors, request/streamed-response byte limits, timeout and budget. `lib/inference.test.ts` verifies privacy refusal before dispatch, private fallback, caller/disposal/configuration aborts, and boundary failures.

The adapter sends the configured provider model explicitly, uses the native secret only in the server-side Bearer header, and makes exactly one request. Redirects are disabled. A custom endpoint receives the same payload; optional authentication is omitted when no key is configured. A URL alone does not establish compatibility with arbitrary Ollama or llama.cpp servers.

A bounded 400/422 context-window error or HTTP 413 becomes `too_large`. Context-code/message recognition is a tested normalization rule, not an assertion that every provider emits those exact codes. Other upstream bodies, errors, request state and credentials are never copied to diagnostics. Deadlines use monotonic time; request timeout includes response validation, and whole-run/caller/disposal limits also apply during model resolution. Streams and timers/listeners are cleaned up on completion and failure. There are no retries.

The adapters are offline implementation modules. No public ask is registered until the CLI/RPC stage. Live Jev and compatible-custom endpoint verification remains outstanding; no supported model version or latency is inferred from these fixture tests. Real-key entry remains the dedicated BBP-12 GUI checkpoint.

## Workers AI

Both selectors now use their own official model contract and account-scoped REST route:

| Selector     | REST model suffix           | Documented context | Judge request cap |
| ------------ | --------------------------- | ------------------ | ----------------- |
| `clef`       | `@cf/cloudflare/clef`       | 65,536 tokens      | 48 KiB UTF-8      |
| `clef-flash` | `@cf/cloudflare/clef-flash` | 24,576 tokens      | 16 KiB UTF-8      |

Primary references checked separately on 2026-11-10 through Context7: [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/), and [REST envelope/authentication](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). Each page documents a required body selector and 1–64 questions with IDs up to 100 characters. The text/JSON common subset retains Judge's existing choice/rubric bounds; images/video remain excluded.

The byte caps are conservative Judge product limits below the general 256 KiB ceiling, not provider byte limits or a guarantee of exact token packing. The model pages document automatic truncation of long text state. Judge rejects an oversized request before dispatch and refuses a response reporting consumption of the entire model context. The API does not provide a universal truncation proof: tokenizer/prompt-packing behavior and absence of undetected server truncation remain live verification limitations, and must not be described as established by fixtures.

`lib/transports/workers-ai.test.ts` records synthetic fixtures derived from these primary contracts. It verifies both paths/body selectors, Bearer auth, typed result/usage, account/endpoint/model fingerprints without keys, HTTP 200 with `success:false`, nonempty error diagnostics, informational messages, malformed envelopes/partial answers, absent/null usage, auth/rate/context failures, request/response bounds and deadlines. The common HTTP transport supplies abort/stream/redirect/retry guarantees. Unsupported model IDs and deferred input modalities fail before dispatch.

Live support for both Clef variants is still pending credentialed BBP-23 verification. No Cloudflare token, real response, latency or live judgment was used to validate this stage.
