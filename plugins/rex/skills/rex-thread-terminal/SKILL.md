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

The pane runs the user's login shell. That shell can be fish or another shell that does not read `sh` syntax.

`rex block call -s "$S" -b "$B" process` prints JSON. Its `foreground.pid` and `foreground.name` are the program that has the pane now. That program is the shell when the shell is at its prompt.

1. Read the pane: `rex capture -s "$S" -b "$B" --trim | tail -n 40`.
2. If a program is running in the foreground, or text is typed at the prompt and not sent, do not type. Tell the user what the pane shows and ask how to proceed.
3. Run `rex block call -s "$S" -b "$B" process`. Keep `foreground.pid` as the shell's pid and `foreground.name` as the shell's name.
4. Type the command and press Enter.
   - If the command is one program and its arguments, type it as it is, then press Enter:

     ```sh
     rex send -s "$S" -b "$B" 'npm test'
     rex send-key -s "$S" -b "$B" enter
     ```

   - If the command uses shell syntax, such as a loop, a pipe, `&&`, `$(…)`, a redirect, or a variable, type it as `sh -c 'COMMAND'`, so that `sh` reads it and not the user's shell. Give the text to `rex send` in a quoted heredoc:

     ```sh
     rex send -s "$S" -b "$B" <<'EOF'
     sh -c 'for i in 1 2 3; do echo "it'\''s $i"; done'
     EOF
     ```

     - The pane gets each character of a quoted heredoc as it is written. Do not escape `$`, `"`, or a backtick for your own shell.
     - The newline that ends the heredoc presses Enter. Do not send `enter` again.
     - Write each single quote in COMMAND as `'\''`.
     - If the shell's name is `fish`, write each `\\` in COMMAND as `\\\\`. fish reads `\\` between single quotes as one `\`.
5. Read the pane again to see the result. A command is finished when the shell prompt is back below its output.
6. If the prompt is not back, run `rex block call -s "$S" -b "$B" process` again and compare `foreground.pid` with the shell's pid.
   - If the two differ, the command is still running, also when it has printed nothing. Read again later, or tell the user that the command is still running. MUST NOT send `ctrl+c` because a command is silent.
   - If the two are equal, the shell itself has the pane. Either the shell is running a command that is part of the shell, such as `read`, `wait`, or `source`, or the shell read the line as unfinished and is waiting for the rest.
     - If the command you typed is part of the shell, or the pane shows output or a question below the line you typed, the command is still running or is asking for input. Do not send `ctrl+c`. Tell the user what the pane shows.
     - Otherwise the line is unfinished. The pane shows nothing below the line you typed, or only the shell's continuation prompt on an empty line, such as `>` in bash or `for>` in zsh. A continuation prompt is not output. Clear the text you typed with `rex send-key -s "$S" -b "$B" ctrl+c`, then type the command again as `sh -c 'COMMAND'`.
7. If you need the exit status, type the command as `sh -c 'COMMAND; echo "exit status: $?"'`. The screen does not show an exit status otherwise.
8. Tell the user which command you ran in the Rex terminal.

A command in `sh -c` runs in a child of the pane's shell. A directory change or a variable set in COMMAND ends with COMMAND. To change the directory or the environment for the commands that follow, type `cd DIR` or `export NAME=value` as a command of its own, not in `sh -c`. If the pane's shell reports an error for it, report the error to the user.

MUST NOT leave text that you typed and did not run at the prompt. Clear it with `ctrl+c`.

To stop a command you started, run `rex send-key -s "$S" -b "$B" ctrl+c`. Do not interrupt a program the user started.

## The `rex` CLI

- If a skill named `rex` is available, load it for the CLI's other commands.
- If no `rex` skill is available, run `rex --help` and `rex COMMAND --help`.
- The `rex` skill tells an agent that runs inside Rex to use `$REX_SESSION` and `$REX_BLOCK`. An agent in a bb thread does not run inside Rex. Use the IDs from `bb rex target` where the `rex` skill uses those variables.
