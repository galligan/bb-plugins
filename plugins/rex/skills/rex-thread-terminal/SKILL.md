---
name: rex-thread-terminal
description: "Runs a bb thread's terminal work in the thread's shared Rex terminal, which the user watches and types in from bb's Rex tab or from Rex. Use when working in a bb thread and a command should be visible to the user or left for the user to take over: a dev server, a long build or test run, an interactive program, or when the user says shared terminal, Rex tab, Rex pane, or pair in the terminal."
---

# The thread's Rex terminal

A bb thread can have one Rex terminal. The user sees it in the thread's **Rex** tab in bb, and in Rex as a window labelled `<thread title> [<thread id>]`. The user and the agent type in the same pane, so the user can watch a command run and take over.

The `rex` CLI drives the terminal. `bb rex target` says which session, window, and block the terminal is.

## Use the thread's Rex terminal

- When the user asks to see a command run, or names the shared terminal, the Rex tab, or the Rex pane.
- When the command keeps running after you stop waiting for it: a dev server, a file watcher, a long build or test run.
- When the command is interactive, or the user may have to answer a prompt.
- When the user is working in the thread's terminal and the task continues what is there.

## Use your own shell instead

- When the command only reads state for your own reasoning, such as `ls`, `rg`, `git status`, or `git diff`.
- When you must parse the output exactly. A capture is a screen of text, not the command's output stream.
- When `bb rex target` fails. If the user asked for the shared terminal, report the failure message to the user.

## Get the target

Run this from the thread, before the first `rex` command of a task:

```sh
bb rex target --json
```

```json
{
  "ok": true,
  "thread": "thr_abc123",
  "session": { "id": "session:…", "label": "bb" },
  "window": {
    "id": "window:…",
    "label": "Fix the login redirect [thr_abc123]",
    "own": true
  },
  "block": { "id": "block:…" }
}
```

- `bb rex target` creates the thread's Rex window if the thread has none. Run it only when you are going to use the terminal.
- `window.own` is `false` when the user picked another window for the thread. That window is the user's. Work in it as the user's guest.
- If a `rex` command reports that the session, window, or block is not found, run `bb rex target --json` again and use the new IDs. The user can close the window or pick another at any time.

## Rules

- MUST pass `-s <session.id> -b <block.id>` to every `rex` command that reads a terminal or types into one. Without them, `rex` acts on a different pane.
- MUST NOT read from, type into, or change any other session, window, or block. If the user names another target, use that target for that request only.
- MUST NOT split, close, move, zoom, or rename the target window or its panes. The Rex tab shows one pane. If the task needs a second pane, ask the user.
- MUST NOT create a Rex session or window for this work.
- MUST NOT stop or restart the Rex server, and MUST NOT run `rex kill`.
- MUST NOT type a secret into the terminal. The user's screen and the scrollback keep it.

## Work in the pane

Set `S` and `B` to `session.id` and `block.id`.

1. Read the pane: `rex capture -s "$S" -b "$B" --trim | tail -n 40`.
2. If a program is running in the foreground, or text is typed at the prompt and not sent, do not type. Tell the user what the pane shows and ask how to proceed.
3. Type the command: `rex send -s "$S" -b "$B" 'npm test'`. `rex send` types the text and does not press Enter.
4. Press Enter: `rex send-key -s "$S" -b "$B" enter`.
5. Read the pane again to see the result. A command is finished when the shell prompt is back below its output. If the prompt is not back, the command is still running: read again later, or tell the user that the command is still running.
6. If you need the exit status, type the command as `sh -c 'COMMAND; echo "exit status: $?"'`. The screen does not show an exit status otherwise.
7. Tell the user which command you ran in the Rex terminal.

To stop a command you started, run `rex send-key -s "$S" -b "$B" ctrl+c`. Do not interrupt a program the user started.

## The `rex` CLI

- If a skill named `rex` is available, load it for the CLI's other commands.
- If no `rex` skill is available, run `rex --help` and `rex COMMAND --help`.
- The `rex` skill tells an agent that runs inside Rex to use `$REX_SESSION` and `$REX_BLOCK`. An agent in a bb thread does not run inside Rex. Use the IDs from `bb rex target` where the `rex` skill uses those variables.
