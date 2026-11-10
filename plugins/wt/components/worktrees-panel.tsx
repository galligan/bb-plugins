import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_InfoSection as InfoSection,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { toast } from "sonner";
import { EmptyState, EmptyStatePanel } from "@/components/ui/empty-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { beginRefresh, connectRefresh } from "./worktrees-refresh.ts";
import { Loading } from "./loading.tsx";
import { RescuedWork } from "./rescued-work.tsx";
import { sortRows } from "../lib/overview.ts";
import { WorktreeRow } from "./worktree-row.tsx";

type Overview = z.infer<typeof rpcContract.overview.output>;
type Rescues = z.infer<typeof rpcContract.rescues.output>;
export function WorktreesPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Overview | null>(null);
  const [rescues, setRescues] = useState<Rescues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const endRefresh = beginRefresh();
    const request = ++sequence.current;
    setLoading(true);
    try {
      const [overview, rescues] = await Promise.all([
        rpc.call("overview", {}),
        rpc.call("rescues", {}),
      ]);
      if (request === sequence.current) {
        setData(overview);
        setRescues(rescues);
        setError(null);
        for (const machine of overview.machines)
          if (machine.error !== null)
            toast.error(`${machine.name}: ${machine.error}`, {
              id: `wt-machine-${machine.hostId}`,
            });
      }
    } catch (error) {
      if (request === sequence.current) {
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        toast.error(message, { id: "wt-overview-error" });
      }
    } finally {
      endRefresh();
      if (request === sequence.current) setLoading(false);
    }
  }, [rpc]);
  useEffect(() => connectRefresh(refresh), [refresh]);
  useEffect(() => {
    void refresh();
    const whenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(whenVisible, 30000);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      sequence.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh]);
  useRealtime("worktrees-changed", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  const hasRows =
    data?.machines.some((machine) => machine.worktrees.length > 0) ?? false;
  const multipleMachines =
    (data?.machines.filter((machine) => machine.worktrees.length > 0).length ??
      0) > 1;
  const ids = new Set(
    data?.machines.flatMap((machine) =>
      machine.worktrees.map(
        (row) => row.environment?.projectId ?? row.projectId ?? "unknown",
      ),
    ) ?? [],
  );
  for (const rescue of rescues?.projects ?? [])
    if (rescue.refs.length > 0 || rescue.error !== null)
      ids.add(rescue.projectId);
  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-4xl space-y-6 p-4 text-foreground sm:p-6">
        {loading && data === null && <Loading label="Loading worktrees…" />}
        {error && (
          <EmptyStatePanel>
            <EmptyState
              icon="AlertTriangle"
              message="Could not load worktrees. Refresh to try again."
            />
          </EmptyStatePanel>
        )}
        {data?.machines
          .filter((machine) => machine.error !== null)
          .map((machine) => (
            <EmptyState
              key={machine.hostId}
              icon="AlertTriangle"
              message={`${machine.name}: worktrees unavailable`}
            />
          ))}
        {data && !hasRows && (
          <EmptyStatePanel>
            <EmptyState
              icon="FolderGit"
              message="No Worktree+ worktrees."
              className="justify-center"
            />
          </EmptyStatePanel>
        )}
        {[...ids].map((projectId) => (
          <InfoSection
            key={projectId}
            label={
              data?.projects.find((project) => project.id === projectId)
                ?.name ?? "Unknown project"
            }
          >
            {data?.machines.map((machine) => {
              const rows = sortRows(
                machine.worktrees.filter(
                  (row) =>
                    (row.environment?.projectId ??
                      row.projectId ??
                      "unknown") === projectId,
                ),
                Date.now(),
              );
              if (rows.length === 0) return null;
              return (
                <div key={machine.hostId}>
                  {multipleMachines && (
                    <p className="py-2 text-xs text-muted-foreground">
                      {machine.name}
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {rows.map((row) => (
                      <WorktreeRow
                        key={row.pathKey}
                        row={row}
                        remove={async () => {
                          try {
                            const result = await rpc.call("removeWorktree", {
                              hostId: machine.hostId,
                              pathKey: row.pathKey,
                            });
                            if (result.status === "failed")
                              throw new Error(result.message);
                          } finally {
                            await refresh();
                          }
                        }}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
            {rescues?.projects
              .filter(
                (rescue) =>
                  rescue.projectId === projectId &&
                  (rescue.refs.length > 0 || rescue.error !== null),
              )
              .map((rescue) => (
                <RescuedWork
                  key={rescue.hostId}
                  rescue={rescue}
                  hostName={
                    data?.machines.find(
                      (machine) => machine.hostId === rescue.hostId,
                    )?.name ?? rescue.hostId
                  }
                />
              ))}
          </InfoSection>
        ))}
      </main>
    </TooltipProvider>
  );
}
