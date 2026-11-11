import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../lib/api-contract.ts";
export function useJudgeRpc() {
  return useRpc<typeof rpcContract>();
}
import { message } from "../lib/ui-errors.ts";
export { message } from "../lib/ui-errors.ts";
/** Clear immediately on invalidation; epoch guards prevent obsolete reads restoring data. */
export function useRead<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  threadIds: readonly string[] = [],
) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key },
  );
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    epoch.current++;
    controller.current?.abort();
    setState({ key });
    setRevision((v) => v + 1);
  }, [key]);
  useRealtime("changed", (value) => {
    if (
      value === null ||
      typeof value !== "object" ||
      !("configuration" in value) ||
      !("threadIds" in value)
    ) {
      refresh();
      return;
    }
    const message = value as { configuration: unknown; threadIds: unknown };
    if (
      message.configuration === true ||
      (threadIds.length > 0 &&
        (message.threadIds === null ||
          (Array.isArray(message.threadIds) &&
            message.threadIds.some(
              (id) => typeof id === "string" && threadIds.includes(id),
            ))))
    )
      refresh();
  });
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    const token = ++epoch.current;
    const pending = new AbortController();
    controller.current = pending;
    setState({ key });
    void load(pending.signal).then(
      (data) => {
        if (epoch.current === token) setState({ key, data });
      },
      (error: unknown) => {
        if (epoch.current === token) setState({ key, error: message(error) });
      },
    );
    return () => {
      epoch.current++;
      pending.abort();
    };
  }, [key, load, revision, connection]);
  return { ...(state.key === key ? state : { key }), refresh };
}
export function useAction(refresh: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function act(operation: () => Promise<unknown>, success = "Saved.") {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
      if (alive.current) {
        setNotice(success);
        refresh();
      }
    } catch (error) {
      if (alive.current) setError(message(error));
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return { pending, error, notice, act };
}
