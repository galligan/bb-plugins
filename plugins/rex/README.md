# bb-plugin-rex

Use a live Rex terminal pane beside a bb thread.

The plugin adds one tab, **Rex**, to a thread's side panel. Each thread that uses it gets its own terminal: a window in a Rex session, named after the thread. The tab shows that terminal and follows it as it changes, so output produced there from anywhere, such as Rex.app or `rex send`, appears in the tab without a refresh. Click the terminal and you can type in it. Open the same window in Rex and you are looking at the same terminal.

This is an early slice. It shows a single pane. See [Limits](#limits).

## Use it

1. Install the plugin: `bb plugin install ./plugins/rex` from a checkout of this repository, after `bun install` at its root.
2. Open a thread, open its side panel, choose **+**, then **Rex**.
3. Click the terminal to give it the keyboard.

The Rex server must be running on the same machine as the bb server, and the `rex` command must be on the bb server's `PATH`. The plugin never starts, stops, or reconfigures a Rex server.

To remove it: `bb plugin uninstall rex`.

## Which terminal it shows

Each thread has its own Rex window, which Rex.app shows as a tab. The first time a thread uses Rex, the plugin creates the window with one shell in it and labels it with the thread's title and ID:

```
Fix the login redirect [thr_abc123]
```

- **Opening the Rex tab uses Rex, and so does an agent asking for the thread's terminal** with `bb rex target`. Both find or create the same window. A thread that does neither gets no window.
- **The shell starts in the thread's workspace**, when that is a directory on the machine the Rex server runs on. Otherwise it starts where Rex starts any shell.
- **The label follows the title.** If the thread's title has changed, the window is relabelled the next time the tab opens. A long title is shortened to fit Rex's limit; the ID never is. The plugin finds the window by the IDs it recorded when it created it, not by the label, so relabelling the window yourself does not lose it.
- **Closing the window in Rex is fine.** The next time the thread's tab opens, the plugin creates a new one.
- **Archiving or deleting the thread closes its window.** That ends whatever is running in it. Only a window the plugin created for that thread is ever closed. Unarchive the thread and open its tab, and it gets a new window.

One setting decides which session the windows go in, **Rex session label** (`sessionLabel`), which defaults to `bb`:

```sh
bb plugin config rex set sessionLabel work
```

- **A session has that label.** New windows are added to it, without changing which window it shows.
- **No session has that label.** The plugin creates it, with the thread's window as its first.
- **More than one session has that label.** The tab shows an error that says so. It does not pick one.

The setting is read each time a window is created, so changing it needs no reload. A thread that already has a window keeps it where it is.

Within its window, the tab shows the focused pane as it was when the tab opened. It does not follow focus afterwards; reopen the tab to pick up a change.

### Showing another window

The line above the terminal names the Rex session and window the thread shows. It is a menu:

- **Any window of any session** on the Rex server can be picked instead. The tab then shows that window's focused pane.
- **Pane of the window shown** appears when that window has more than one pane, and picks which one to show: a particular pane, or whichever has focus.
- **This thread's window** goes back.

The pick is kept for the thread and survives a reload of bb and of the plugin. A picked window is yours, not the plugin's: the tab types into it but never claims or resizes its panes, never relabels it, and archiving the thread does not close it. The thread's own window, if it has one, stays as it is until the thread is archived, and none is made while another is picked. If a picked window is closed, the thread goes back to its own.

The list is read when the menu opens, without attaching to any session: the plugin joins a session only once you pick a window in it.

## Agents

The thread's terminal is meant to be shared: an agent working in the thread can run its commands there, where you can watch them from bb or from Rex and take over.

- **`bb rex target`** prints the Rex session, window, and block of a thread's terminal, with `--json` for the IDs alone. Run from a thread, it answers for that thread; `--thread <id>` names another. It uses the same lookup as the Rex tab, so it creates the thread's window if the thread has none, and it answers with the window you picked for the thread if you picked one.
- **The `rex-thread-terminal` skill** ships with the plugin. It tells an agent when the shared terminal is the right place for a command and when its own shell is, how to get the target, and how to work there with the `rex` CLI. It holds the agent to that one pane: no other session or window, and no splitting or closing, unless you ask.
- **A thread that already has a Rex window** gets one line added to its agent's instructions, pointing at the skill. A thread that has never used Rex gets nothing.

The skill and the instruction line reach an agent when its session next starts, not in the middle of one.

## Typing

The terminal takes keys only while it has focus, which a click gives it. The cursor is drawn as an outline until then.

- **Keys** go to the terminal, including Ctrl combinations, Tab, Escape, and the arrow keys. They are sent to the pane directly, so your Rex key bindings (leader keys, split commands) do not fire from inside bb: the tab shows one pane and could not show their effect.
- **Command combinations** stay with bb and the browser. Copy works on text you select in the terminal, and paste goes to the terminal as a paste, so a program that asked for bracketed paste gets one.
- **Option** types the character your keyboard layout gives it, such as `å`. It does not act as Meta.
- **Order** is kept. The tab sends one request at a time, each carrying everything typed since the last, and the backend passes each batch to Rex on one connection, where Rex runs input in the order it arrives.

Click anywhere outside the terminal to give the keyboard back.

## Scrolling back

Scroll the tab with the wheel or trackpad to read earlier output, and back down to return to the live screen. A scrollbar on the right shows where you are and can be dragged. It appears while the pointer is over the terminal or the view has just moved.

- **History comes with the terminal.** The stream opens with a snapshot that carries the terminal's scrollback, so output from before the tab opened is there to scroll to.
- **The screen shows first, and history is restored as you scroll to it.** A snapshot holds the screen and then the history above it in pages of a few hundred rows, newest first. The tab draws the screen as soon as it is restored and restores older pages when the view gets within 1,000 rows of the oldest one it has. A terminal nobody scrolls back never pays for its history.
- **The scrollbar counts the whole history from the start.** The snapshot says how many rows it carries, so the slider is the right length before the rows are restored and does not grow as they arrive. Dragging it far back restores what that needs first.
- **Up to 100,000 rows are kept**, counting what the snapshot brings and what builds up afterwards. bb's built-in terminal keeps 10,000. Memory is the reason for a limit: history costs 0.7 to 0.85 MiB per 1,000 rows at 80 columns, more for a wider pane, and the memory is not given back while the tab is open. Past the limit the oldest rows go, a page at a time, so the figure is approximate. Once the last page is restored or the limit is reached, the snapshot is freed.
- **Clearing the scrollback clears what was still to come.** When a program erases the scrollback or resets the terminal, the pages not yet restored are dropped too, since they are older than what was cleared. If a page turns out to be damaged, restoring stops there and the status line says so; the terminal keeps working with the history it has.
- **Only the rows on screen are read** for each frame, wherever the view is.
- **Typing or pasting** returns the view to the live screen. Output that arrives while you are scrolled back does not move the view.
- **Resizing** keeps the first row of a scrolled-back view where it is.
- **Scrolling is local.** It moves this tab's view only. Nothing is sent to Rex, and no other client's view changes.

A full-screen program, such as an editor or a pager, runs on the alternate screen, which has no history. There the wheel does what it does in bb's terminal: it sends the program one arrow key per wheel event. That does reach Rex, as typing would. If the program has asked for mouse events itself, the wheel sends nothing, because the tab does not report the mouse.

## Size and ownership

A Rex terminal takes its size and its default colors from the client that owns it, so changing either changes the pane for every client looking at it. The tab changes a pane only where that is safe:

- **In the window the plugin created for the thread**, the tab claims the pane, fits it to the panel beside its scrollbar, and gives it bb's terminal colors. It refits when the panel changes size and sends the colors again when the app's theme changes. This holds whichever session the window is in, including one you created yourself and named in `sessionLabel`.
- **In a window you picked for the thread**, the tab never claims the pane and never asks for a size or sets a theme. It draws the pane at the size its owner gave it, scrolling sideways if that is wider than the panel. Typing works the same.
- **If another client takes the pane**, such as when you open the window in Rex.app, the tab stops asking and draws the size Rex reports. If ownership comes back, for example when that client leaves, the tab fits the pane to its panel and gives it bb's colors again.

The plugin knows which windows it created because it records each one's session and window IDs in its own storage, under the thread's ID, when it creates it. The record outlives a plugin reload. It does not infer this from a pane having no owner, or from a window's label: a background pane of yours can have no owner, and anyone can type a label.

## Appearance

The tab is drawn to look like bb's built-in terminal, and follows the app's theme when it changes, without reopening.

- **Colors** come from the same theme variables bb's terminal reads: `--sidebar` behind the text, `--foreground` for text and the cursor, `--muted` for selected text, and `--ansi-0` to `--ansi-15` for the 16 ANSI colors. Bold text in one of the first eight is drawn in its bright form, as bb draws it.
- **Colors a program chooses outright** are drawn as it asked: 24-bit colors, and palette colors 16 to 255.
- **Font** is bb's terminal font, `--font-terminal`, at 12 pixels, in cells sized from the font the way bb sizes them.
- **Cursor** is a block that blinks while the terminal has focus and an outline when it does not.

In a pane the tab has claimed, Rex is given the same colors, so a program that asks the terminal for its colors gets the ones on screen.

In a pane it has not claimed, the tab still draws with bb's colors, but Rex keeps the colors its owner gave it and the tab ignores them. The two can disagree. A program that picked light or dark output from the background Rex.app reported can look wrong in the tab when bb's theme is the opposite: dark text meant for a light background, drawn on bb's dark one. The same applies to a program that redefines the default colors or the first 16 palette colors itself; the tab draws bb's.

## How it works

- **Backend** (`server.ts`, `lib/rex-*.ts`). A browser cannot reach the Rex server's Unix socket, so the bb server relays. `GET /stream?thread=<id>` finds or creates the thread's window (`lib/thread-window.ts`), opens a Rex data connection to its terminal, and answers with the terminal's byte stream for as long as the tab reads it. It reads from Rex no faster than the tab takes the bytes, so a snapshot of tens of megabytes is passed through without being held in memory. `POST /input` takes the tab's keys, pastes, focus changes, panel size, and terminal colors for an open stream and sends them to Rex with `block.event`, `com.superlogical.terminal.resize`, and `com.superlogical.terminal.set_theme`. Each open tab holds one control connection and one data connection to Rex, and both close when the tab does. `bb rex target` (`lib/target-command.ts`) runs that same find-or-create for an agent. `GET /targets` lists the windows a thread could show, read with Rex's `target.complete`, and `POST /target` stores a pick. The backend also listens for a thread being archived or deleted, and closes its window. When the plugin loads, it closes the windows of recorded threads that were archived while it was not running.
- **Frontend** (`app.tsx`, `components/`, `lib/pane-decoder.ts`). The stream opens with a snapshot of the terminal in Ghostty's snapshot format, followed by everything the terminal's program writes. The tab decodes both with a vendored build of libghostty-vt compiled to WebAssembly, then draws the result as text.

The relay is a streamed HTTP response. It is sent as `application/octet-stream` with `Cache-Control: no-transform`, which keeps bb's response compression from holding small chunks back.

The plugin follows the Rex API as the server documents it (`GET /llms.txt` on the server's socket), at API revision 11.

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

- **No mouse reporting.** A program that asks for mouse events gets none, and the wheel does nothing in it.
- **Scrollback differs a little from bb's terminal.** The wheel moves the view at once where bb's terminal animates it, a click on the scrollbar's track does nothing, and the tab keeps up to 100,000 rows where bb's terminal keeps 10,000.
- **No composed input.** Dead keys and input methods are not sent. Key releases and modifier keys on their own are not sent either, which matters only to programs that ask for them through the Kitty keyboard protocol.
- **One pane at a time.** The tab does not draw a window's splits. It shows one pane of the window, chosen in the menu.
- **A picked window keeps its size.** A pane wider than the panel scrolls sideways; the tab does not scale it down.
- **Panes are listed by label and ID**, not by where they sit in the window, and the list does not say which has focus.
- **Pastes are capped** at 128 KiB.
- **One session for every thread's own window.** The setting applies to all threads.
- **A thread deleted while the plugin was not running keeps its window.** bb no longer knows the thread, so the plugin cannot tell that it was deleted rather than that the request failed, and it leaves the window alone. Close it in Rex.
- **A shell on another machine starts in the default directory.** The workspace of a thread that runs on another enrolled machine is not a path the local Rex server can use.
- **Local Rex only.** The plugin looks for Rex on the bb server's machine, over a Unix socket. It does not connect to remote Rex hosts or to a Rex server on another enrolled bb machine.
- **A simple renderer.** It draws text, 24-bit and palette colors, bold, italic, faint, inverse, invisible, underline, strikethrough, overline, wide characters, and the cursor. It does not draw images, hyperlinks, or distinct underline styles and colors, and it reads every cell on every frame. It draws text with the browser, where bb's terminal paints a canvas, so glyph edges can differ slightly.
- **No resume.** When the stream ends, the tab keeps the last frame and offers **Reconnect**, which starts a new stream from a fresh snapshot.

## Develop

```sh
bun run check   # tsc
bun run test    # node --test, including the vendored WASM
bun run build   # bb plugin build
```

`lib/` holds the logic and its tests. Nothing under it needs a bb server, a Rex server, or a browser: the protocol modules work on bytes, and the decoder tests make their own snapshots with the vendored module.

The menu is bb's dropdown menu and button, vendored from bb's component registry into `components/ui/` at the release named in `components.json`. Update them with `shadcn add @bb/<name>`.

`lib/fake-rex.ts` is a small Rex server for tests: sessions, windows, and the control methods the plugin calls to manage them.

For a live loop, install the plugin from this directory and run `bb plugin dev`.
