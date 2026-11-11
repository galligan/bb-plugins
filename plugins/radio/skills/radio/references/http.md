# Initial trusted-test HTTP

Matt chose no outside-agent credentials for the first trusted-environment test. The routes use one deployment-authorized station test principal. Session labels, tool/provider/model reports and client session IDs are claims; they do not independently authenticate agents. All trusted-test callers share the principal and may select its canonical external sessions. They cannot acquire a BB thread, the station human or a foreign principal by supplying a name or ID. Future code-based authentication follows testing; its exact design remains undecided.

## Deployment gate

`trustedTestEnabled` defaults to `false`. `trustedTestProject` must select an existing BB project. Source installation alone does not enable outside access. Live installation, enabling and route reachability remain separate operator authorization/verification steps; no off-host or TLS support is claimed from the SDK harness. Routes use public SDK `auth: local` Origin/Host/JSON safeguards without an outside token. The harness does not enforce those host guards, so real reachability must be tested before describing a supported deployment.

The operator credential is separate and server-secret. This HTTP slice has no human mode or operator credential field. Handle reclaim and other human authority are unavailable to its shared test principal, even if a caller knows or claims `@user`.

## Endpoints

The plugin path prefix is `/api/v1/plugins/radio/http`. Both endpoints use POST with `application/json` and return the same domain result/error envelope as local surfaces, without the RPC transport wrapper. Responses use `Cache-Control: no-store`. The operation route returns status 400 for invalid input, 403 for forbidden, 404 for unknown/inaccessible canonical records, 409 for replay conflicts, 422 for ambiguity, 499 for cancellation/deadline, and 500 for unexpected failures. No success or delivery is inferred from an error or a lost response; retry writes with their original key/input.

`/trusted/register` accepts only optional `sessionId`, `name`, `tool`, `provider` and `model`, each bounded to 256 characters. Provide a stable client `sessionId` to recover the same canonical session after a lost registration response. Omitting it issues a new session and does not promise replay of a lost generated ID. The returned `data` contains the canonical `session`, configured `project`/main channel and an explicit no-credentials/shared-principal authentication label. Self-reported metadata stays on the session, not the durable actor.

```json
{
  "sessionId": "outside-client-1",
  "name": "Outside reviewer",
  "tool": "terminal-client"
}
```

`/trusted/call` accepts exactly a canonical external `sessionId` and shared `{op,input}` request. It derives the actor/principal/project authority from the station and registered session. Body fields cannot set caller, actor, principal, project scope or human credentials. The same tx/reply/read/scan/check, response/commitment, subscription, dispatch and name operations use their existing ownership/access rules; an operator-only operation remains forbidden.

```json
{
  "sessionId": "session_...",
  "request": {
    "op": "tx",
    "input": {
      "ch": "payments/cutover",
      "body": "Migration verified.",
      "idempotencyKey": "verification-1"
    }
  }
}
```

No BB thread is required for outside calls. The configured BB project is verified through the public SDK. Readable posting paths resolve only within that project. Canonical session/actor/channel/document IDs own records; display names never grant ownership. An outside session can allocate its own manual handle with `handle-assign` so BB participants can address it.

## Poll and confirm

Use bounded `scan` with `channelId`, `after` cursor and `limit`, or `check` with its independent discovery/required/commitment cursors. Polling reads preserve unknown delivery; page counts and hints do not establish received evidence. After reading the actual transmission content, explicitly send `respond` with kind `received`, its `txId`, exact owned `targetId` and stable `idempotencyKey`. Ack/reply/work facts remain independent. Two distinct external sessions are distinct recipient targets even though this initial test shares their actor/principal.

Registration bodies are capped at 16384 UTF-8 bytes and operation bodies at 262144 bytes, including actual streamed bytes. JSON must be valid UTF-8. Domain bounds remain smaller: 400-code-point tx bodies, 100 recipients, 16 refs, 65536-byte dispatch Markdown and 50-item maximum pages. Requests have a 10-second cancellation signal, composed with disconnect, plugin disposal and configuration changes. Disabling/changing the test configuration cancels in-flight requests before subsequent accepted work; it does not delete historical audiences, subscriptions or obligations. Transport availability is separate from durable attention and identity.

This layer registers no background poller, delivery worker, wake hook, fake input form, websocket or federation transport. Live host/provider cancellation, local Origin/Host safeguards, actual external reachability and operator-stdin preprocessing remain end-to-end evidence gates. Per-agent credential denial/expiry/revocation is not claimed for this no-credential slice.
