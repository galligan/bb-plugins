import { useEffect, useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginThreadActionDataInput } from "@get-bb/plugin-sdk/app";

import type { rpcContract } from "@/server";
import { updateStackRead, type StackRead } from "@/lib/stack-read.ts";

/** Refresh only visible headers or the selected stack panel, including split panes. */
export function useCurrentStacks(
  { threadIds }: PluginThreadActionDataInput,
  enabled = true,
) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [results, setResults] = useState<ReadonlyMap<string, StackRead>>(
    new Map(),
  );
  const key = JSON.stringify(threadIds);
  useEffect(() => {
    if (!enabled) return;
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
              return { threadId, stack };
            } catch {
              return { threadId, stack: null };
            }
          }),
        );
        if (live)
          setResults(
            (previous) =>
              new Map(
                entries.map(({ threadId, stack }) => [
                  threadId,
                  updateStackRead(previous.get(threadId), stack),
                ]),
              ),
          );
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
  }, [key, rpc, sdk, enabled]);
  return results;
}
