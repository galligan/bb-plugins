import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { toast } from "sonner";
import { EmptyState, EmptyStatePanel } from "@/components/ui/empty-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { beginRefresh, connectRefresh } from "./worktrees-refresh.ts";
import { Loading } from "./loading.tsx";
import { RescuedWork } from "./rescued-work.tsx";
import { Fragment } from "react";
import { ProjectWorktrees } from "./project-worktrees.tsx";

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
      <main className="mx-auto w-full box-border max-w-5xl space-y-4 px-4 pb-4 pt-3 text-foreground md:px-5 md:pt-4">
        <p className="text-sm leading-5 text-muted-foreground">
          Worktrees created by Worktree+, and what removing each would lose.
        </p>
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
          <Fragment key={projectId}>
            {data && (
              <ProjectWorktrees
                projectId={projectId}
                title={
                  data.projects.find((project) => project.id === projectId)
                    ?.name ?? "Unknown project"
                }
                data={data}
                multipleMachines={multipleMachines}
                remove={async (hostId, pathKey) => {
                  try {
                    const result = await rpc.call("removeWorktree", {
                      hostId,
                      pathKey,
                    });
                    if (result.status === "failed")
                      throw new Error(result.message);
                  } finally {
                    await refresh();
                  }
                }}
              />
            )}
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
                  projectName={
                    data?.projects.find((project) => project.id === projectId)
                      ?.name ?? "Unknown project"
                  }
                  hostName={
                    data?.machines.find(
                      (machine) => machine.hostId === rescue.hostId,
                    )?.name ?? rescue.hostId
                  }
                />
              ))}
          </Fragment>
        ))}
      </main>
    </TooltipProvider>
  );
}
