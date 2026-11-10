import { useEffect, useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/server";
import type { CurrentStack } from "@/lib/current-stack.ts";

/** Only poll threads whose headers BB currently displays, including split panes. */
export function useHeaderStacks({
  threadIds,
}: {
  threadIds: readonly string[];
}) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [stacks, setStacks] = useState<ReadonlyMap<string, CurrentStack>>(
    new Map(),
  );
  const key = JSON.stringify(threadIds);
  useEffect(() => {
    const ids: string[] = JSON.parse(key);
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (!live || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const entries = await Promise.all(
          ids.map(async (threadId) => {
            try {
              const thread = await sdk.threads.get({ threadId });
              const stack = await rpc.call("stack_current", {
                projectId: thread.projectId,
                threadId,
              });
              return [threadId, stack] as const;
            } catch {
              return null;
            }
          }),
        );
        if (live) setStacks(new Map(entries.filter((entry) => entry !== null)));
      } finally {
        pending = false;
      }
    };
    void refresh();
    // Graphite changes its private database without emitting a BB event.
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, rpc, sdk]);
  return stacks;
}
