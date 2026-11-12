import { useState } from "react";
import {
  experimental_useRpcQuery as useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import {
  workerOverviewContract,
  type WorkerOverviewRow,
} from "../../lib/work/overview.ts";
import { usePageVisible } from "../../lib/ui/use-page-visible.ts";
import { SettingsGroup } from "../settings/layout.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { WorkerRow } from "./row.tsx";

export function WorkerOverview({ botId }: { botId: string }) {
  const visible = usePageVisible(),
    [offset, setOffset] = useState(0);
  const query = useRpcQuery({
    contract: workerOverviewContract,
    method: "workerOverview",
    input: { botId, offset },
    enabled: visible,
  });
  const state =
    query.data?.botId === botId && query.data.offset === offset
      ? query.data
      : undefined;
  return (
    <SettingsGroup
      title="Workers"
      description="Owned working conversations. Opening one uses native BB navigation and starts no turn."
    >
      {query.isLoading && (
        <div role="status" aria-label="Loading workers">
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {query.error && (
        <div role="alert">
          <p className="text-xs text-destructive">
            Could not read owned workers. Check the connection and refresh.
          </p>
          {state && (
            <p className="text-xs text-muted-foreground">
              Showing the last loaded worker records.
            </p>
          )}
        </div>
      )}
      {visible && state && (
        <WorkerRows workers={state.workers} empty={!query.error} />
      )}
      {!visible && (
        <p className="text-xs text-muted-foreground">
          Worker reads pause while this view is hidden.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!visible || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.error ? "Retry workers read" : "Refresh workers"}
        </Button>
        <div className="flex items-center gap-2">
          {offset > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!visible || query.isFetching}
              onClick={() => setOffset(offset - 10)}
            >
              Previous workers
            </Button>
          )}
          {state?.nextOffset !== null && state?.nextOffset !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!visible || query.isFetching || Boolean(query.error)}
              onClick={() => setOffset(state.nextOffset!)}
            >
              More workers
            </Button>
          )}
        </div>
      </div>
      {state?.hasMoreBeyondLimit && (
        <p className="text-xs text-muted-foreground">
          This view contains the first 100 worker records. Additional workers
          remain retained; open a known conversation through BB.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Native activity is not assignment completion or permission to resume.
        Archived or uncached conversations can be absent from the active view.
      </p>
    </SettingsGroup>
  );
}

function WorkerRows({
  workers,
  empty,
}: {
  workers: WorkerOverviewRow[];
  empty: boolean;
}) {
  // This public hook reads BB's live query cache from any surface. It is
  // distinct from the sidebar-only navigation context. No archive query.
  const cache = useSidebarThreads();
  const ids = new Set(
    workers.flatMap((worker) =>
      [
        worker.threadId,
        worker.report.threadId,
        worker.requestedParentThreadId,
      ].filter((id): id is string => id !== null),
    ),
  );
  const lookup = new Map(
    cache.status === "ready"
      ? cache.threads
          .filter((thread) => ids.has(thread.id))
          .map((thread) => [thread.id, thread])
      : [],
  );
  return (
    <>
      {cache.status !== "ready" && (
        <p role="status" className="text-xs text-muted-foreground">
          {cache.status === "loading"
            ? "Reading native thread status…"
            : "Native thread status is unavailable. Worker ownership is still recorded."}
        </p>
      )}
      {empty && workers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No worker records on this page. Workers appear here after an explicit
          assignment from your bot.
        </p>
      )}
      <div className="divide-y divide-border" aria-label="Owned workers">
        {workers.map((worker) => (
          <WorkerRow
            key={worker.conversationId}
            worker={worker}
            native={worker.threadId ? lookup.get(worker.threadId) : undefined}
            lookup={lookup}
          />
        ))}
      </div>
    </>
  );
}
