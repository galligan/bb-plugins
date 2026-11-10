# Compatibility and research

Research date: 2026-11-10. This is contract/source inspection, not an installed Radio or live delivery test. No Dispatch/old Radio code was changed. No server was exposed and no tokens were minted/read.

## Baseline

- Installed BB CLI reported `0.49.0`.
- `bb plugin types plugins/judge --check` reported package pin and host SDK `0.6.132`, without writing.
- Exact declarations came from an existing local installation of `@get-bb/plugin-sdk@0.6.132`, `bundled-types/bb-plugin-sdk.d.ts`.
- Local BB source was at `a124a8d4f211ae101ceb6f09e99ebaee9cadc011`. Its bundled declarations were older than the installed SDK. Use it for historical implementation evidence, not as the installed release contract.
- Installed `bb-plugin-authoring` references also had older instruction-refresh wording. Exact 0.6.132 declarations took precedence.

The local declaration path used was `/Users/mg/Developer/bb/bb-plugins/node_modules/.bun/@get-bb+plugin-sdk@0.6.132+6363e488c8850005/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. This is a research locator, not a dependency or portable link. Re-resolve and recheck before implementation.

## Public SDK evidence

Line numbers below refer only to that inspected declaration file.

| Capability | Symbol / lines | Finding |
| --- | --- | --- |
| Database | `PluginStorage`, 19830 | Plugin SQLite database and ordered migration helper support local transactional records |
| Caller context | `PluginCliContext`, 20554; `PluginAgentToolContext`, 20678 | CLI thread/project context is optional; native tools carry thread/project and cancellation signal |
| HTTP | `PluginHttp`, 20466 | Local/token/none auth; per-plugin token header; experimental WebSocket route |
| RPC | `PluginRpc`, 20506; caller context, 168 | Typed local RPC and caller plugin/client distinction; cross-plugin call composition |
| Instructions | `PluginAgents`, 21211–21269 | Resolution at start/submit does not hot-update a live provider session's construction-time instructions |
| Events | `PluginThreadEventPayloads`, 19974 | Idle gives thread and lastAssistantText, not causal stop reason; observe-only lifecycle |
| Dispatch decisions | `MessageDispatchHookDecision`, 20207 | Proceed/wait/reject; no rewrite/enrichment |
| Dispatch attempt | `PluginDispatchAttemptKind`, 20255; `PluginHookSignatures`, 20372 | Start versus join; only message.dispatch hook; steering can fall back to starting |
| Send | `SendMessageRequest`, 13316; threads.send, 19323 | Steer modes available; delivery semantics still require adapter evidence |
| Stop | threads.stop, 19327 | Explicit stop wins over live work; cannot claim success when runtime stop is unconfirmed |
| Mention context | `PluginMentionProviderRegistration.resolve`, 21366 | Selected mention resolves fresh context at message-send time |
| Delayed result precedent | tool context, 20678; `PluginUi.requestInput`, 21382 | Genuine forms detach native calls; eventual results can steer/start; stop/delete/dispose abort |

Lifecycle event delivery is ephemeral, not replayed while a plugin is unloaded. Realtime signals likewise do not persist messages. No public universal after-tool hook or safe generic pre-completion context hook was identified. This is a boundary of the inspected contract, not proof that alternative delivery compositions are impossible.

See [delivery](delivery.md) for supported building blocks versus candidate compositions and SDK proposals.

## Repository patterns

- [Plugin UI and UX](../../../docs/dev/ui-ux.md): additive navigation/side-panel surfaces, public host components and compact-layout behavior.
- [Plugin patterns](../../../docs/dev/plugin-patterns.md): host/server boundaries and independently buildable packages.
- [Judge compatibility](../../judge/docs/COMPATIBILITY.md): installed SDK baseline and observe-only lifecycle precedent.
- [Rex HTTP adapter](../../rex/server.ts): existing plugin HTTP registration pattern.
- Local BB source `plugins/workflows/src/server.ts:84,116,180,215`: database, typed RPC, agent configuration and idle listener.
- Local BB source `plugins/docs/app.tsx:2366`: additive navigation panel.
- Local BB source `apps/server/src/services/threads/thread-lifecycle.ts:1432`: interruption can append `turn/completed` with interrupted status; event names alone are not success evidence.

Examples are references, not shared runtime dependencies. Revalidate exact APIs before copying a pattern.

## Dispatch findings

Checkout: `/Users/mg/Developer/outfitter/dispatch`, HEAD `74fff0a70fdc5a196f401808fe0e5e3c40044495`.

| Source in Dispatch | Evidence |
| --- | --- |
| `docs/usage/README.md:894` | Subscriptions create durable lane-addressed inbox notifications; inbox delivery does not wake, turn delivery queues input |
| `src/outfitter/dispatch/core/subscriptions.py:118` | Required recipient lane; message creation separate from queued-turn bridge |
| `src/outfitter/dispatch/core/handlers.py:2071` | Inbox read is pure fetch; separate ack |
| `src/outfitter/dispatch/registry/store.py:2927` | SQLite inbox state, timestamps and queue linkage |
| `src/outfitter/dispatch/core/queue.py:106` | Successful send can mark linked inbox acknowledged before work completion |
| `src/outfitter/dispatch/core/ops.py:687` | Inbox list/read/ack operations; no generic board-post/reply/claim contract found |
| `docs/usage/deliveries.md:71` | Provider submission evidence distinct from execution; ambiguous outcomes are not blindly resent |
| `src/outfitter/dispatch/surfaces/mcp.py:1` and `daemon/control.py:1` | CLI/MCP share local Unix-socket operation execution; not independent remote-agent authentication |
| `skills/dm/SKILL.md:77` | Reply hint uses another thread send, not passive inbox reply linkage |

Borrow durable storage separate from execution, stable references and idempotent replay. Do not import provider-delivery reconciliation machinery into simple SQLite message acceptance.

## Historical Radio

Planning sources: `/Users/mg/Developer/outfitter/trailblazing/plans/radio/v0-spec.md` and `legacy.md`. Source checkout: `/Users/mg/Developer/outfitter/radio`.

The complete legacy document was read. Useful ideas include short txs, first-class refs, per-actor acknowledgments, separate commitments, attention digests, immutable messages and explicit session lifecycle. The original sync-ready ambition does not require implementing sync now.

Actual source is partial: `src/trails/index.ts` exports ensureActor, ensureChannel, ensureProject, readSessionContext, transmit and reply. `src/parsing/body.ts:60` implements 400 prose / 2000 raw limits. `src/trails/transmit.ts` transactionally writes tx/ref/mention/tag data and explicitly defers ping signal hookup. Tables in `src/store-schema.ts` do not establish that all proposed operations shipped.

| Historical choice | Current BB Radio direction |
| --- | --- |
| roger / ack alias | `ack` only; no roger alias |
| seen/opened views | `received` with explicit adapter/participant evidence; do not equate every read with receipt |
| dispatch = imported external event | Dispatch = detailed owned or externally referenced document |
| communication forbids owned docs | Radio can own supporting dispatches while retaining external source authority |
| actor ID derived from handle | Immutable identity independent of mutable/reclaimable handles |
| soft aliases can close commitments | Explicit identity/authority and auditable delegation |
| first wilco owns it, no locks | Atomic acceptance for explicitly exclusive work |
| trust all local processes | Explicit external auth boundary; shared-token limitations disclosed |
| elaborate radio personality | Concise normal output; metaphor carried by name and verbs |
| SessionStart/check and Stop/out | Intent to investigate per provider, not proof of BB hook fidelity |

The referenced historical fieldwork skill was absent at its documented path and not found in installed skill roots. No Trails framework work or issue filing was performed; these repositories served as read-only design references. Radio's BB design does not require adopting Trails as a runtime dependency.

## Remaining evidence gaps

No adapter has been proven live. In particular: guarded steering races and grouped queues; external HTTP route reachability through BB remote access; per-provider hooks; session receipt evidence; plugin unload with pending work; and station-to-station forwarding remain unverified. See [scope and verification](decisions.md).
