import {
  ThreadTitle,
  useBbNavigate,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  experimental_resolveThreadStatus as resolveThreadStatus,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { WorkerOverviewRow } from "../../lib/work/overview.ts";
import { ResourceRow } from "../ui/resource/row.tsx";
import { Button } from "../ui/button.tsx";

export function WorkerRow({
  worker,
  native,
  lookup,
}: {
  worker: WorkerOverviewRow;
  native?: PluginSidebarThread;
  lookup: ReadonlyMap<string, PluginSidebarThread>;
}) {
  const navigate = useBbNavigate();
  function destination(threadId: string, fallback: string, label: string) {
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto max-w-full justify-start whitespace-normal p-0 text-left"
        aria-label={label}
        onClick={() => navigate.toThread(threadId)}
      >
        {lookup.has(threadId) ? <ThreadTitle threadId={threadId} /> : fallback}
      </Button>
    );
  }
  return (
    <div className="py-2">
      {worker.threadId ? (
        <BoundWorker
          worker={worker}
          threadId={worker.threadId}
          native={native}
        />
      ) : (
        <p className="py-3 text-sm font-medium">{worker.title}</p>
      )}
      <details className="pb-2 text-xs text-muted-foreground">
        <summary
          className="cursor-pointer"
          aria-label={`Relationships and setup for ${worker.title}`}
        >
          Relationships and setup
        </summary>
        <dl className="mt-2 space-y-2">
          <div>
            <dt className="font-medium">Reporting destination</dt>
            <dd>
              {worker.report.threadId
                ? destination(
                    worker.report.threadId,
                    worker.report.isOwnMain
                      ? "Main conversation"
                      : "Report destination",
                    `Open report destination for ${worker.title}`,
                  )
                : "Not bound to a physical conversation"}
              <p>
                {worker.report.kind === "conversation"
                  ? "Follows its logical conversation mapping."
                  : "An explicitly selected BB thread."}
              </p>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Requested native parent</dt>
            <dd>
              {worker.requestedParentThreadId
                ? destination(
                    worker.requestedParentThreadId,
                    "Parent conversation",
                    `Open requested parent for ${worker.title}`,
                  )
                : "None"}
              <p>
                This creation request is separate from the reporting contract.
              </p>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Creation record</dt>
            <dd>
              {worker.phase === "bound"
                ? "Conversation bound"
                : worker.phase === "spawning"
                  ? "Creation outcome needs inspection; no automatic retry."
                  : "Creation planned; no conversation bound yet."}
            </dd>
          </div>
        </dl>
        {worker.error && (
          <p
            role="alert"
            className="mt-2 whitespace-pre-wrap break-words text-destructive"
          >
            {worker.error}
          </p>
        )}
      </details>
    </div>
  );
}

function BoundWorker({
  worker,
  threadId,
  native,
}: {
  worker: WorkerOverviewRow;
  threadId: string;
  native?: PluginSidebarThread;
}) {
  const navigate = useBbNavigate();
  const draft = useSidebarThreadDraft(threadId);
  const rowStatus = useSidebarThreadRowStatus(threadId);
  const status = native
    ? resolveThreadStatus({
        thread: native,
        hiddenThreads: [],
        hasUnsubmittedDraft: draft.hasUnsubmittedDraft,
        rowStatus,
      })
    : null;
  const title = native?.displayTitle ?? worker.title;
  return (
    <ResourceRow
      title={native ? <ThreadTitle threadId={threadId} /> : worker.title}
      leading={
        status ? (
          <span aria-hidden>
            <ThreadStatusGlyph
              indicator={status.indicator}
              rowStatus={status.rowStatus}
              size="compact"
            />
          </span>
        ) : undefined
      }
      description={
        native
          ? (status?.label ?? "No native activity indicator")
          : "Not in the active BB view; current activity is unknown."
      }
      openLabel={`Open worker ${title}`}
      onOpen={() => navigate.toThread(threadId)}
    />
  );
}
