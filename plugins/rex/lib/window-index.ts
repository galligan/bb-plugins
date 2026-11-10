// Which threads the plugin has made a Rex window for, answerable at once.
//
// The records are in the plugin's storage, which takes a moment to read, and
// the hook that adds a line to a thread's agent instructions cannot wait. So
// the thread IDs are also kept here, in memory: read from storage when the
// plugin loads, and kept current as records are written and removed.

/** The stored records, as far as the index needs them. */
export interface StoredThreadWindows {
  /** The IDs of the threads that have a record. */
  list(): Promise<string[]>;
  /** Whether the thread has a record now. */
  has(threadId: string): Promise<boolean>;
}

export class ThreadWindowIndex {
  readonly #threads = new Set<string>();

  has(threadId: string): boolean {
    return this.#threads.has(threadId);
  }

  add(threadId: string): void {
    this.#threads.add(threadId);
  }

  delete(threadId: string): void {
    this.#threads.delete(threadId);
  }

  /** The threads known now. Later changes do not alter the list returned. */
  threads(): string[] {
    return [...this.#threads];
  }

  /**
   * Adds every thread that has a stored record. Rejects if storage cannot be
   * read, leaving whatever was known in place, and can be called again.
   *
   * Each record is looked at again just before its thread is added. The list
   * is a moment old by then, and a thread archived in that moment has had its
   * record removed: it must not come back.
   */
  async load(stored: StoredThreadWindows): Promise<void> {
    for (const threadId of await stored.list()) {
      if (await stored.has(threadId)) this.#threads.add(threadId);
    }
  }
}

/**
 * Calls `attempt` after `everyMs`, and again each time it rejects, until it
 * resolves. Returns a function that stops it for good: nothing is scheduled
 * after that, not even by an attempt that was already under way.
 */
export function retryUntilDone(
  attempt: () => Promise<void>,
  everyMs: number,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const later = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      attempt().then(() => {}, later);
    }, everyMs);
  };
  later();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
