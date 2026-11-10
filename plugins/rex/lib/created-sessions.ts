// Which Rex sessions this plugin created.
//
// The tab may claim and resize a pane only in a session the plugin made.
// "The pane has no owner" does not show that: a background pane in the user's
// own session has no owner either. So the plugin records the ID of each
// session it creates, in its own storage, where the record outlives a reload.
// Rex never reuses a session ID.

/** The storage key the list of session IDs is kept under. */
export const CREATED_SESSIONS_KEY = "created-sessions";

/** Reads the stored list. Anything that is not a list of IDs counts as empty. */
export function readCreatedSessions(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((id): id is string => typeof id === "string");
}

/**
 * The list to store after a look at the server's sessions: the recorded
 * sessions that still exist, and `created` if this lookup made a session.
 */
export function updateCreatedSessions(
  recorded: readonly string[],
  live: readonly string[],
  created?: string,
): string[] {
  const kept = recorded.filter((id) => live.includes(id));
  return created === undefined || kept.includes(created)
    ? kept
    : [...kept, created];
}
