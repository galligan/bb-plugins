// Thread attachment: which BB thread has a branch checked out. Collapsed to a
// glyph, named on hover, opened on click. The join neither Graphite nor BB
// can make alone.

import type { ReactNode } from "react";
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChatIcon } from "@hugeicons/core-free-icons";

import type { CurrentStackThread } from "@/lib/current-stack.ts";
import { cn } from "@/lib/utils";

/**
 * A thread working on this branch. Hover names it, click opens it.
 * `gt ls` prints the worktree path here; a thread is the thing you actually want.
 */
export function ThreadMarks({
  threads,
}: {
  readonly threads: CurrentStackThread[];
}) {
  const { threadId } = useBbContext();
  if (threads.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {threads.map((thread) => (
        <ThreadMark
          key={thread.id}
          thread={thread}
          isCurrent={thread.id === threadId}
        />
      ))}
    </span>
  );
}

const THREAD_PILL =
  "group/thread flex max-w-[14rem] items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground";

/** Collapsed to the glyph until hover, then the pill grows to name the thread. */
function ThreadLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <HugeiconsIcon icon={ChatIcon} className="size-3 shrink-0" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/thread:max-w-[12rem] group-hover/thread:opacity-100">
        {children}
      </span>
    </>
  );
}

function ThreadMark({
  thread,
  isCurrent,
}: {
  readonly thread: CurrentStackThread;
  readonly isCurrent: boolean;
}) {
  const navigate = useBbNavigate();

  // Linking the thread you are reading it in goes nowhere. Name it and stop.
  if (isCurrent) {
    return (
      <span title="This thread" className={cn(THREAD_PILL, "cursor-default")}>
        <ThreadLabel>this thread</ThreadLabel>
      </span>
    );
  }

  return (
    <button
      type="button"
      title={thread.title}
      aria-label={`Open thread: ${thread.title}`}
      onClick={(event) => {
        event.stopPropagation();
        navigate.toThread(thread.id);
      }}
      className={cn(
        THREAD_PILL,
        "cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground",
      )}
    >
      <ThreadLabel>{thread.title}</ThreadLabel>
    </button>
  );
}
