// Which session a thread's window goes in, and which pane of a window the
// tab shows.
//
// The session is the one whose label matches the plugin's `sessionLabel`
// setting. The pane is the focused block of the thread's window.

import { z } from "zod";

/** The creator of terminal blocks, the only kind of block this plugin draws. */
const TERMINAL_CREATOR = "com.superlogical.terminal";

/** The flavor of block the plugin puts in a session it creates. */
export const SHELL_FLAVOR = "com.superlogical.terminal.shell";

export const sessionListSchema = z.object({
  sessions: z
    .array(z.object({ session_id: z.string(), label: z.string() }))
    .nullable(),
});

/** The parts of `session.view` this plugin reads. */
export const sessionViewSchema = z.object({
  active_window_id: z.string().nullish(),
  windows: z
    .array(
      z.object({
        window_id: z.string().nullable(),
        label: z.string().optional(),
        focused_block_id: z.string().nullish(),
        layers: z
          .array(
            z.object({
              blocks: z
                .array(
                  z.object({
                    block_id: z.string().nullable(),
                    creator_name: z.string().optional(),
                  }),
                )
                .nullable(),
            }),
          )
          .nullable(),
      }),
    )
    .nullish(),
});

export type SessionList = z.infer<typeof sessionListSchema>;
export type SessionView = z.infer<typeof sessionViewSchema>;

export type SessionChoice =
  | { kind: "found"; sessionId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; count: number };

/** Finds the one session with `label`. More than one is never resolved. */
export function chooseSession(list: SessionList, label: string): SessionChoice {
  const matches = (list.sessions ?? []).filter(
    (session) => session.label === label,
  );
  const [only] = matches;
  if (only === undefined) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  return { kind: "found", sessionId: only.session_id };
}

export type PaneChoice =
  { kind: "terminal"; blockId: string } | { kind: "none"; reason: string };

/** Finds the focused block of the window `windowId`, if it is a terminal. */
export function chooseWindowPane(
  view: SessionView,
  windowId: string,
): PaneChoice {
  const window = (view.windows ?? []).find(
    (candidate) => candidate.window_id === windowId,
  );
  if (window === undefined) {
    return { kind: "none", reason: "The window is no longer there." };
  }
  const blockId = window.focused_block_id;
  if (blockId == null) {
    return { kind: "none", reason: "The window has no focused pane." };
  }
  const block = (window.layers ?? [])
    .flatMap((layer) => layer.blocks ?? [])
    .find((candidate) => candidate.block_id === blockId);
  if (block?.creator_name !== TERMINAL_CREATOR) {
    return { kind: "none", reason: "The focused pane is not a terminal." };
  }
  return { kind: "terminal", blockId };
}
