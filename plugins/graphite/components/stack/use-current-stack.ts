import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { rpcContract } from "@/server";
import type { CurrentStack } from "@/lib/current-stack.ts";

/** Refresh Graphite metadata while its thread stays open. */
export function useCurrentStack(projectId: string | null, threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<{
    stack: CurrentStack | null;
    error: boolean;
  }>({ stack: null, error: false });

  useEffect(() => {
    if (projectId === null) {
      setResult({ stack: null, error: true });
      return;
    }
    setResult({ stack: null, error: false });
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (!live || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await rpc.call("stack_current", { projectId, threadId });
        if (live) setResult({ stack: result, error: false });
      } catch {
        if (live) setResult({ stack: null, error: true });
      } finally {
        pending = false;
      }
    };
    void refresh();
    // `gt` can change metadata without changing the route or remounting this UI.
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [rpc, projectId, threadId]);

  return result;
}
