// What a thread is set to show in place of the default: another window than
// its own, a particular pane of a window, or both.
//
// A thread shows its own Rex window, and that window's focused pane, unless
// the person picks otherwise in the Rex tab. The pick is kept per thread in
// the plugin's storage, so it outlives a reload. A window picked this way is
// not the plugin's: the tab never claims or resizes its panes, and archiving
// the thread does not close it.

import { z } from "zod";

/** The storage key prefix a thread's pick is kept under. */
export const THREAD_VIEW_KEY_PREFIX = "thread-view:";

export const threadViewSchema = z.object({
  sessionId: z.string().min(1),
  windowId: z.string().min(1),
  /** The pane to show, or null for whichever has focus in the window. */
  blockId: z.string().min(1).nullable(),
});

/** The window, and perhaps the pane, picked for a thread. */
export type ThreadView = z.infer<typeof threadViewSchema>;

/** Where the plugin keeps each thread's pick, by thread ID. */
export interface ThreadViewStore {
  get(threadId: string): Promise<unknown>;
  set(threadId: string, view: ThreadView): Promise<void>;
  delete(threadId: string): Promise<void>;
}
