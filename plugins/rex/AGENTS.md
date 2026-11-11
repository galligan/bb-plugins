# AGENTS.md

`bb-plugin-rex` (plugin id `rex`) adds a **Rex** tab to a bb thread's side panel. Each thread that uses the tab gets its own window in a Rex session; the tab streams that window's terminal, types into it, and scrolls its history. `bb rex target` gives an agent the same window. [README.md](README.md) describes the behaviour for people.

## Map

- `server.ts` — registration only: the setting, the HTTP routes, `bb rex`, the instructions hook, and the archive and delete listeners. It holds the plugin's storage adapters and reads the thread from bb.
- `app.tsx`, `components/` — the tab. `use-pane.ts` reads the stream and sends input; `terminal-view.tsx` draws; `scrollback.tsx` handles the wheel and scrollbar; `target-menu.tsx` is the window menu.
- `components/ui/`, `lib/utils.ts`, `lib/portal-scope.ts` — bb's controls, vendored from the `@bb` registry at the release in `components.json`.
- `lib/thread-window.ts` — finds or makes a thread's window, and closes it. `lib/thread-view.ts` is the window or pane a person picked for a thread. `lib/window-label.ts` builds the label. `lib/window-index.ts` is the in-memory list of threads that have a window.
- `lib/rex-control.ts`, `lib/rex-socket.ts`, `lib/data-handshake.ts`, `lib/rex-pane.ts` — the Rex connections and the relay. `lib/rex-directory.ts` lists every session's windows. `lib/pane-claim.ts` decides when the tab may size or color a pane. `lib/pane-input.ts` validates input from the tab.
- `lib/snapshot.ts`, `lib/rex-messages.ts`, `lib/pane-decoder.ts`, `lib/snapshot-history.ts`, `lib/pane-view.ts`, `lib/history-clear.ts` — the stream: snapshot framing, Rex's own messages, lazy history, and the view.
- `lib/wasm.ts`, `lib/ghostty.ts`, `lib/frame-reader.ts`, `lib/ghostty-build.ts`, `vendor/ghostty-vt.wasm` — libghostty-vt.
- `lib/target-command.ts`, `lib/targets.ts` — `bb rex target` and the menu's requests.
- `skills/rex-thread-terminal/` — the skill shipped to agents that work in a thread.
- `lib/fake-rex.ts`, `lib/fake-rex-socket.ts`, `lib/pane-fixture.ts` — test support: an in-memory Rex, that Rex behind a real control socket with a `rex` command that reports it, and a pane restored by the real WASM.

## Invariants

- MUST NOT stop, restart, or reconfigure a Rex server. Find the socket with `rex server status --json --autostart=false`.
- MUST NOT claim a pane, request a size, or set a theme unless the window is the one the plugin made for the thread (`ThreadWindow.own`). A terminal follows its owner, so these calls change the pane for every Rex client. Decide this on the backend, in `PaneClaim`, never from a value the tab sends.
- MUST NOT close, relabel, or resize a window that has no `thread-window:` record. A label that looks like the plugin's is not a record.
- MUST NOT destroy a Rex session. Undo a window with `session.close_window`.
- If a thread needs a terminal, call `ensureThreadWindow`. The tab and `bb rex target` must land in the same window, and that function serializes creation with closing.
- Before a call that changes a session, attach the connection to that session with `session.attach`. Rex refuses the call otherwise, and `FakeRex` refuses it the same way.
- MUST NOT attach to a session to list its windows. Use `listWindows` in `lib/rex-directory.ts`, which uses `target.complete`. Attach only to the session of the window a thread shows.
- MUST NOT send anything to Rex when the view scrolls on the primary screen. Scrolling moves this tab's own terminal.
- Keep input in order: the tab has one `/input` request in flight (`InputQueue`), and the backend writes each batch to one control connection in order.
- Keep the plugin id `rex`, the setting key `sessionLabel`, and the storage key prefixes `thread-window:` and `thread-view:`. Changing one strands what is stored.
- Parse everything that crosses a boundary with a schema: Rex's answers, the tab's requests, stored records. Do not use `as` casts or `any`.

## Vendored code

- `vendor/ghostty-vt.wasm` is a pinned build. `lib/ghostty-build.ts` records its version and hash, and a test fails if the file does not match. If you replace the file, update both in the same change, and re-check the enum values and struct layouts in `lib/ghostty.ts`, `lib/frame-reader.ts`, and `lib/snapshot-history.ts` against that build's headers.
- Do not hand-edit `components/ui/` to change behaviour. Update a control with `shadcn add @bb/<name>` and review the diff.

## Tests

- `bun run test` runs `lib/**/*.test.ts` with `node --test`, then `tests/*.test.tsx` with Vitest. Neither needs a bb server, a Rex server, or a browser.
- If a change calls Rex, test it against `FakeRex`. If `FakeRex` lacks the method, add it there in the shape the Rex API page gives.
- If a change touches decoding, scrolling, or history, test it against the real WASM through `lib/pane-fixture.ts`.
- `lib/relay.test.ts` uses real sockets on a Unix socket in a temporary directory.
- `lib/server.test.ts` loads the real `server.ts` under `createFakePluginHost`. If a change touches a route, `bb rex`, the setting, the instructions hook, or a listener, test it there. `lib/fake-rex-socket.ts` serves a `FakeRex` on a temporary Unix socket and puts a `rex` command that reports it first on `PATH`, so the server finds Rex the way it does in use and never reaches a real one.
- `tests/*.test.tsx` run with Vitest and jsdom and load the real `app.tsx` through `@get-bb/plugin-sdk/testing/app`. The tab reaches the plugin's routes with `fetch`, so stub `fetch` there. An open terminal is not covered: test decoding in `lib/`, and check drawing live.
- Do not check in the running app what one of these can show.

## Checking in the running app

- Check in the running app only what a test cannot show: drawing, layout, scrolling, and the host's tab strip. Use an isolated bb instance; see [verification](../../docs/dev/verification.md#choose-the-test-boundary).
- Use a Rex session created for the check, under a label of its own. Destroy it afterwards.
- MUST NOT attach to, stream, or type into a session you did not create. Reading session, window, and block labels for the window menu is allowed.
- A thread's own window is closed when the thread is archived. To check that, use a thread created for the check.
