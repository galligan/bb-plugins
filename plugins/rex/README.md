# bb-plugin-rex

Watch a live Rex terminal pane beside a bb thread.

The plugin adds one tab, **Rex**, to a thread's side panel. The tab shows one terminal from the local Rex server and follows it as it changes: output produced in that terminal from anywhere, such as Rex.app or `rex send`, appears in the tab without a refresh.

This is a first slice. It is read-only and shows a single pane. See [Limits](#limits).

## Use it

1. Install the plugin: `bb plugin install ./plugins/rex` from a checkout of this repository, after `bun install` at its root.
2. Open a thread, open its side panel, choose **+**, then **Rex**.

The Rex server must be running on the same machine as the bb server, and the `rex` command must be on the bb server's `PATH`. The plugin never starts, stops, or reconfigures a Rex server.

To remove it: `bb plugin uninstall rex`.

## Which terminal it shows

One setting decides, **Rex session label** (`sessionLabel`), which defaults to `bb`:

```sh
bb plugin config rex set sessionLabel main
```

- **A session has that label.** The tab shows it. Set the label to an existing session's name, such as `main`, to watch that session.
- **No session has that label.** The tab creates one with a single shell terminal, then shows it. The plugin gives up ownership of the new terminal at once, so it takes its size from whichever Rex client opens it next.
- **More than one session has that label.** The tab shows an error that says so. It does not pick one.

Within the session, the tab shows the focused pane of the active tab, as it was when the tab opened. It does not follow focus afterwards; reopen the tab to pick up a change.

Every thread's Rex tab shows the same terminal. The setting is read each time a tab opens, so changing it needs no reload.

## How it works

- **Backend** (`server.ts`, `lib/rex-*.ts`). A browser cannot reach the Rex server's Unix socket, so the bb server relays. `GET /stream` finds or creates the session, opens a Rex data connection to the terminal, and answers with the terminal's byte stream for as long as the tab reads it. Each open tab holds one control connection and one data connection to Rex, and both close when the tab does.
- **Frontend** (`app.tsx`, `components/`, `lib/pane-decoder.ts`). The stream opens with a snapshot of the terminal in Ghostty's snapshot format, followed by everything the terminal's program writes. The tab decodes both with a vendored build of libghostty-vt compiled to WebAssembly, then draws the result as text.

The relay is a streamed HTTP response, because plugin routes cannot upgrade to WebSocket. It is sent as `application/octet-stream` with `Cache-Control: no-transform`, which keeps bb's response compression from holding small chunks back.

The plugin follows the Rex API as the server documents it (`GET /llms.txt` on the server's socket), at API revision 11.

### Read-only

The plugin never claims a terminal and never asks for a size or a theme. A Rex terminal takes its size and colors from the client that owns it, so either would resize or recolor the pane in your own Rex client. The tab draws the terminal at the size the stream reports, and scrolls when that is larger than the panel.

## The vendored libghostty-vt build

`vendor/ghostty-vt.wasm` is a prebuilt, unmodified `ghostty-vt.wasm` from the [`tip` release](https://github.com/ghostty-org/ghostty/releases/tag/tip) of [Ghostty](https://github.com/ghostty-org/ghostty).

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Version         | `1.1.0-dev+f28124c`                                                |
| sha256          | `1f136e43e2243737d280f7f4d0ed51ae48256ddb66401ba2f7c0eb113b2ce489` |
| Size            | 1,241,205 bytes                                                    |
| Downloaded      | 2026-11-09                                                         |
| Snapshot format | version 1                                                          |

The `tip` release is rebuilt nightly, so a later download is a different build. The version and hash are also recorded in `lib/ghostty-build.ts`, and a test fails if the file does not match them.

To move to a newer build:

1. Download `ghostty-vt.wasm` and `libghostty-vt-source.tar.gz` from the same release. Replace the file in `vendor/` and update `lib/ghostty-build.ts` and the table above.
2. Check the enum values and struct layouts in `lib/ghostty.ts` and `lib/frame-reader.ts` against `include/ghostty/vt/*.h` in the source archive. The byte layout of the C API's structs is also printed by the module's own `ghostty_type_json()`.
3. Run the tests. `lib/pane-decoder.test.ts` runs the real module end to end.

### Snapshot format versions

A Rex server encodes snapshots with the libghostty it was built with, and a decoder accepts only its own format version. If Rex moves to a newer format before this plugin does, or the reverse, the tab says that Rex and the plugin are out of step and names both versions. It reads the snapshot's 10-byte envelope itself to do so, because libghostty reports a wrong version with the same error as a corrupt snapshot.

### License

Ghostty is distributed under the MIT License, copyright (c) 2024 Mitchell Hashimoto and Ghostty contributors. The full text is in [`vendor/LICENSE-ghostty.txt`](vendor/LICENSE-ghostty.txt) and applies to `vendor/ghostty-vt.wasm`.

Ghostty's own list of third-party code linked into libghostty-vt builds (`deps/libghostty-vt-third-party.json` in the source archive for this build) names highway (Apache-2.0 OR BSD-3-Clause), simdutf (Apache-2.0 OR MIT), translate_c (MIT), uucode (MIT AND Unicode-3.0), and wuffs (Apache-2.0 OR MIT). That list is for the library in general; which of them are compiled into the WebAssembly build was not checked.

## Limits

- **No input.** No keyboard, mouse, paste, or scrolling of the terminal's own scrollback.
- **One pane.** No tabs, splits, or layout. The pane is chosen when the tab opens.
- **No resizing.** The terminal keeps the size its owner gave it. A terminal wider than the panel scrolls sideways.
- **One session label for every thread.** There is no per-thread choice.
- **Local Rex only.** The plugin looks for Rex on the bb server's machine, over a Unix socket. It does not connect to remote Rex hosts or to a Rex server on another enrolled bb machine.
- **A simple renderer.** It draws text, 24-bit and palette colors, bold, italic, faint, inverse, invisible, underline, strikethrough, overline, wide characters, and the cursor's position and shape. It does not draw images, hyperlinks, cursor blinking, or distinct underline styles and colors, and it reads every cell on every frame.
- **No resume.** When the stream ends, the tab keeps the last frame and offers **Reconnect**, which starts a new stream from a fresh snapshot.

## Develop

```sh
bun run check   # tsc
bun run test    # node --test, including the vendored WASM
bun run build   # bb plugin build
```

`lib/` holds the logic and its tests. Nothing under it needs a bb server, a Rex server, or a browser: the protocol modules work on bytes, and the decoder tests make their own snapshots with the vendored module.

For a live loop, install the plugin from this directory and run `bb plugin dev`. While testing, point `sessionLabel` at a session made for the purpose, so the tab does not show a session with private content.
