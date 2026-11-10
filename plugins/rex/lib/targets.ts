// What the Rex tab's window menu asks the backend and is told: the windows a
// thread could show, which one it shows now, and a change of pick.

import { z } from "zod";

import type { DirectorySession } from "./rex-directory.ts";
import { threadViewSchema, type ThreadView } from "./thread-view.ts";

const paneSchema = z.object({ blockId: z.string(), label: z.string() });
const windowSchema = z.object({
  windowId: z.string(),
  label: z.string(),
  panes: z.array(paneSchema),
});

/** The answer to `GET /targets`. */
export const targetsSchema = z.object({
  /** Every session on the Rex server, with its windows and their panes. */
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      label: z.string(),
      windows: z.array(windowSchema),
    }),
  ),
  /** The window the plugin made for the thread, if it has made one. */
  own: z.object({ sessionId: z.string(), windowId: z.string() }).nullable(),
  /** What was picked for the thread, or null for its own window. */
  pick: threadViewSchema.nullable(),
});

export type Targets = z.infer<typeof targetsSchema>;

/** The body of `POST /target`. A null target goes back to the own window. */
export const setTargetSchema = z.object({
  thread: z.string().min(1),
  target: threadViewSchema.nullable(),
});

/** Whether `target` names a window, and a pane if it names one, in `sessions`. */
export function targetExists(
  sessions: readonly DirectorySession[],
  target: ThreadView,
): boolean {
  const window = sessions
    .find((session) => session.sessionId === target.sessionId)
    ?.windows.find((candidate) => candidate.windowId === target.windowId);
  if (window === undefined) return false;
  return (
    target.blockId === null ||
    window.panes.some((pane) => pane.blockId === target.blockId)
  );
}
