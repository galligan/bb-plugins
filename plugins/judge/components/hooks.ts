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
export function message(error: unknown): string {
  const fields =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code = typeof fields.code === "string" ? fields.code : "";
  const detail = typeof fields.message === "string" ? fields.message : "";
  const hints: Record<string, string> = {
    invalid_input: "Check the IDs, required fields, JSON and model limits.",
    invalid: "Check the IDs, required fields, JSON and model limits.",
    missing_set:
      "Choose an existing saved set. Import sets with bb judge sets import.",
    missing_model: "Save this model first.",
    unknown_badge_outcome:
      "Badge keys must name the saved set's final outcomes.",
    persistence_failed:
      "Judge could not read or save its local records. Retry; check plugin logs if it persists.",
    private_model_required:
      "Choose a saved model that explicitly permits private data before selecting it as the private fallback.",
    calibration_not_current:
      "Run and review a fresh complete case report for the current set and model policy before accepting it.",
    calibration_unavailable:
      "Review a complete, current primary case report before accepting calibration.",
  };
  return (
    (error instanceof SyntaxError ? hints.invalid : undefined) ??
    (Object.hasOwn(hints, detail) ? hints[detail] : undefined) ??
    (Object.hasOwn(hints, code) ? hints[code] : undefined) ??
    "Judge could not complete this request. Refresh and check the saved configuration or plugin logs."
  );
}
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
