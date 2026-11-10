// `bb rex target`: where a thread's Rex terminal is.
//
// An agent working in a bb thread runs it to learn which Rex session, window
// and pane to do its terminal work in, so the person can watch and take over
// from bb's Rex tab or from Rex. It goes through the same operation the tab
// does, so it makes the thread's window the first time, and it answers with
// the window the person picked for the thread if they picked one.

import {
  cliCommand,
  defineCli,
  PluginCliError,
  type PluginCliRegistration,
} from "@get-bb/plugin-sdk";

import { PaneError } from "./pane-error.ts";
import type { ThreadWindow } from "./thread-window.ts";

/** What the command reports about a thread's terminal. */
export function targetReport(threadId: string, window: ThreadWindow) {
  return {
    thread: threadId,
    session: { id: window.sessionId, label: window.sessionLabel },
    window: {
      id: window.windowId,
      label: window.windowLabel,
      /** False when the person picked this window for the thread. */
      own: window.own,
    },
    block: { id: window.blockId },
  };
}

/** The report as a person or an agent reads it in a terminal. */
export function targetText(threadId: string, window: ThreadWindow): string {
  const select = `-s ${window.sessionId} -b ${window.blockId}`;
  return [
    `Rex terminal of thread ${threadId}`,
    `  session  ${window.sessionId}  ${window.sessionLabel}`,
    `  window   ${window.windowId}  ${window.windowLabel}`,
    `  block    ${window.blockId}`,
    window.own
      ? "  The window is this thread's own."
      : "  The user picked this window for the thread. It is theirs.",
    "",
    "Select the pane in every rex command:",
    `  rex capture ${select} --trim`,
    `  rex send ${select} 'TEXT'`,
    `  rex send-key ${select} enter`,
    "",
  ].join("\n");
}

/**
 * The plugin's `bb rex` command. `resolve` finds, or makes, the window a
 * thread shows.
 */
export function targetCli(
  resolve: (threadId: string) => Promise<ThreadWindow>,
): PluginCliRegistration {
  return defineCli({
    name: "rex",
    summary: "Find the Rex terminal that belongs to a bb thread",
    commands: {
      target: cliCommand({
        summary:
          "Print the Rex session, window and block of a thread's terminal, creating the thread's Rex window if it has none",
        options: {
          thread: {
            type: "string",
            placeholder: "id",
            aliases: ["thread-id"],
            description:
              "Thread whose terminal to find. Defaults to the thread the command runs in",
          },
          json: {
            type: "boolean",
            description: "Print the IDs and labels as JSON",
          },
        },
        async run(input, context) {
          const threadId = input.options.thread ?? context.threadId;
          if (threadId === undefined || threadId === "") {
            throw new PluginCliError("No thread to find a terminal for.", {
              code: "thread_required",
              hint: "Run the command from a bb thread, or pass --thread <id>.",
            });
          }
          let window: ThreadWindow;
          try {
            window = await resolve(threadId);
          } catch (error) {
            if (!(error instanceof PaneError)) throw error;
            throw new PluginCliError(error.message, { code: error.code });
          }
          return {
            exitCode: 0,
            stdout: input.options.json
              ? `${JSON.stringify({ ok: true, ...targetReport(threadId, window) })}\n`
              : targetText(threadId, window),
          };
        },
      }),
    },
  });
}
