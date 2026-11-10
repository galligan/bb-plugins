# Judge live verification

## Jev checkpoint preparation (BBP-12)

The CLI/RPC stage is independently approved at `423aee639c8f88390b9955cce312c6dd774f2ed0` (BBP-11 round2, clean5/5). Root five checks pass with183 tests. This checkpoint does not establish live inference support.

On BB0.49.0 / SDK0.6.132, Judge0.1.0 is installed from the dedicated managed worktree. Only Judge was reloaded; Worktree+ was untouched. Live `bb judge --help` and the model/readiness commands work. No inferred model/default exists on install. A nonsecret model record `jev` now selects pinned `jev-1.13.0`, `allowPrivate:false`; no global/private default is selected. The [primary model documentation](https://github.com/typesafe-docs/typesafeai/blob/main/docs/12-models.md) documents this versioned selector and moving aliases. Do not use the unlisted bare `jev` as a provider selector.

The current native BB form was rechecked through the actual local server UI at `/settings/plugins/judge?view=installed&configure=judge`. Navigation: Settings → Installed plugins → Judge [Experimental] → settings button. The Jev field is `type=password`. A known noncredential dummy entered through the form changed its marker from `[not set]` to `[set]`; sanitized `models check jev` changed from `not_configured/missing_key` to `configured/ready`, with `tested:false` and `latencyMs:null`. A Judge-only reload preserved configured readiness. The dummy was removed with native unset; fresh navigation again showed `[not set]`, and sanitized readiness returned missing_key. No inference was invoked and no stored value, secret file, prefix or screenshot was inspected. A fresh tab was used after a reload left the existing form temporarily empty.

The user handoff points to [BB's remote Judge settings](https://galligan.getbb.app/settings/plugins/judge?view=installed&configure=judge). The route is locally verified; the remote page requires the user's own BB sign-in. The user enters the real key directly in the BB-owned secret form. Saving does not start a provider call. Only sanitized readiness may be observed after entry. BB documents server-side mode-0600 secret files; this is not a keychain/encryption guarantee.

A synthetic explicit ask without `--not-private` returned `private_not_allowed/private_model_required` before transport access, confirming the live CLI respects the model's default private policy. It contained no real BB thread state.

## Pending credentialed verification

**Pending user GUI entry. No paid request or live provider result has been recorded.** BBP-12 remains incomplete. Independently ready offline work can continue while this dependency is pending; BBP-23's live-provider gate cannot pass from fixture or configured status alone.

After sanitized readiness becomes configured, the authorized smoke request is one explicit `bb judge ask --model jev --noul 'Is publicSynthetic true?' --state '{"publicSynthetic":true}' --not-private --json`. Record only the run ID, pinned/returned provider model, typed answer, input-token usage if available, and latency. Then reload Judge and recheck sanitized readiness without inspecting the key. Do not send private BB state unless explicit model policy allows it. A failed attempt remains typed evidence, not a live-support claim; avoid automatic retries or repeated credential prompting.

Workers AI and compatible custom endpoints still require their own later GUI and credentialed verification. No support or latency claim is inferred from offline fixtures.
