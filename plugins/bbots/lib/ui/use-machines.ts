import { useEffect, useState } from "react";
import { useSdk, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { usePageVisible } from "./use-page-visible.ts";

export type Machine = { id: string; name: string; status: string };
export function useMachines() {
  const sdk = useSdk(),
    connection = useRealtimeConnectionState();
  const visible = usePageVisible();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    sdk.hosts
      .list({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) {
          setMachines(rows);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sdk, visible, connection, refresh]);
  return {
    machines,
    unavailable: !visible || error || loading,
    loading,
    error,
    refresh: () => setRefresh((n) => n + 1),
  };
}
