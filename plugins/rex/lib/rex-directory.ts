// The windows a thread could be shown instead of its own: every window of
// every session on the Rex server, with the panes in each.
//
// Rex gives a session's windows only to a connection attached to it, and
// attaching is more than a list needs: the plugin has no business joining a
// person's sessions to fill a menu. `target.complete` answers without that.
// Asked for everything in one session, it lists each window and block with
// its label, which is all the menu shows.

import { z } from "zod";

import type { RexCaller } from "./rex-control.ts";
import { sessionListSchema } from "./session.ts";

export interface DirectoryPane {
  blockId: string;
  label: string;
}

export interface DirectoryWindow {
  windowId: string;
  label: string;
  /** The window's panes. Rex does not say here which has focus. */
  panes: DirectoryPane[];
}

export interface DirectorySession {
  sessionId: string;
  label: string;
  /** The session's windows, in the order Rex shows them. */
  windows: DirectoryWindow[];
}

const completionsSchema = z.object({
  completions: z
    .array(
      z.object({
        form: z.string(),
        target: z.object({
          kind: z.string(),
          window_id: z.string().optional(),
          block_id: z.string().optional(),
          label: z.string(),
          ordinal: z.number().optional(),
        }),
      }),
    )
    .nullable(),
});

type Completions = z.infer<typeof completionsSchema>;

/**
 * Turns one session's completions into its windows. Each window and block
 * is listed once for each way of naming it; the entry by short ID is the one
 * every window and block has, so that is the one counted.
 */
export function windowsFrom(completions: Completions): DirectoryWindow[] {
  const byId = (completions.completions ?? []).filter(
    (completion) => completion.form === "id",
  );
  const windows = byId
    .flatMap(({ target }) =>
      target.kind === "window" && target.window_id !== undefined
        ? [
            {
              windowId: target.window_id,
              label: target.label,
              ordinal: target.ordinal ?? Number.MAX_SAFE_INTEGER,
            },
          ]
        : [],
    )
    .sort((a, b) => a.ordinal - b.ordinal);
  return windows.map(({ windowId, label }) => ({
    windowId,
    label,
    // A detached block has no window and is in no window's list.
    panes: byId.flatMap(({ target }) =>
      target.kind === "block" &&
      target.window_id === windowId &&
      target.block_id !== undefined
        ? [{ blockId: target.block_id, label: target.label }]
        : [],
    ),
  }));
}

/** Lists every session's windows and panes, without attaching to any. */
export async function listWindows(rex: RexCaller): Promise<DirectorySession[]> {
  const list = await rex.call("session.list", undefined, sessionListSchema);
  const sessions: DirectorySession[] = [];
  for (const session of list.sessions ?? []) {
    const completions = await rex.call(
      "target.complete",
      {
        kinds: ["window", "block"],
        prefix: "",
        scope: { session: session.session_id },
      },
      completionsSchema,
    );
    sessions.push({
      sessionId: session.session_id,
      label: session.label,
      windows: windowsFrom(completions),
    });
  }
  return sessions;
}
