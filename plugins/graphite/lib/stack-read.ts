import type { CurrentStack } from "./current-stack.ts";

export interface StackRead {
  stack: CurrentStack | null;
  error: boolean;
}

/** Temporary read failures retain content; confirmed absence clears it. */
export function updateStackRead(
  previous: StackRead | undefined,
  incoming: CurrentStack | null,
): StackRead {
  if (incoming === null || incoming.outcome === "unavailable") {
    return { stack: previous?.stack ?? null, error: true };
  }
  return { stack: incoming, error: false };
}
