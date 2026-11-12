import {
  ThreadTitle,
  UrlLink,
  useBbNavigate,
  experimental_FileLink as FileLink,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { commitmentUiContract } from "../../lib/ui/commitment-contracts.ts";
import { Button } from "../ui/button.tsx";

const unknown = {
  "source-reconciliation-required":
    "Reference needs reconciliation; status is unknown.",
  "manual-source-read":
    "Read the recorded task file; its status is not inferred.",
  "changed-during-read":
    "The reference changed during this read; status is unknown.",
  missing: "The linked task is missing; status is unknown.",
  "wrong-source":
    "The task differs from its recorded source; status is unknown.",
  unavailable: "The task source is unavailable; status is unknown.",
} as const;

export function CommitmentDetail({
  threadId,
  botId,
  id,
  active,
}: {
  threadId: string;
  botId: string;
  id: string;
  active: boolean;
}) {
  const query = useRpcQuery({
    contract: commitmentUiContract,
    method: "botCommitment",
    input: { threadId, id },
    enabled: active,
  });
  const state =
    !query.error &&
    query.data?.threadId === threadId &&
    query.data.botId === botId
      ? query.data
      : undefined;
  return (
    <div className="min-w-0 space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!active || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.error ? "Retry obligation read" : "Refresh obligation"}
        </Button>
      </div>
      {query.isLoading && <p role="status">Inspecting obligation…</p>}
      {query.error && (
        <p role="alert" className="text-xs text-destructive">
          Could not inspect this obligation. No current status is established.
        </p>
      )}
      {state && (
        <>
          <p className="whitespace-pre-wrap break-words">{state.what}</p>
          <p role="status">
            {state.availability === "local" ||
            state.availability === "available"
              ? `${state.authority === "commitment" ? "Manual obligation" : "Tasks"} · ${state.status?.replaceAll("_", " ") ?? "unknown"}`
              : unknown[state.availability]}
          </p>
          {state.limitation && (
            <p className="text-xs text-muted-foreground">{state.limitation}</p>
          )}
          {state.task && (
            <p className="text-xs text-muted-foreground">
              {state.task.key} · {state.task.title}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Inspected {state.inspectedAt}. Refresh after changes in the
            authoritative source.
          </p>
          <div>
            <p className="text-xs font-medium">
              Owed by an owned {state.owner.role} conversation
            </p>
            {state.owner.threadId ? (
              <OwnerLink threadId={state.owner.threadId} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Its physical conversation is not bound.
              </p>
            )}
          </div>
          {state.reference.kind === "markdown" && (
            <div className="space-y-1">
              <FileLink
                target={{
                  kind: "host",
                  hostId: state.reference.hostId,
                  path: state.reference.path,
                }}
                className="underline underline-offset-4"
              >
                Open recorded tasks.md
              </FileLink>
              <p className="text-xs text-muted-foreground">
                Recorded reference: {state.reference.reference}. The file
                remains authoritative; opening it does not record completion.
              </p>
            </div>
          )}
          {state.reference.kind === "tasks" && (
            <p className="text-xs text-muted-foreground">
              Open Tasks in BB to inspect or update the linked task. This view
              owns no separate task status.
            </p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              Evidence and attribution
            </summary>
            <p className="mt-2">
              Revision {state.revision} · {state.author} · {state.reason}
            </p>
            <ul className="mt-2 space-y-1">
              {state.evidence.map((item, i) => (
                <li key={i} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
            {state.evidence.length === 0 && (
              <p>No evidence references recorded.</p>
            )}
          </details>
        </>
      )}
    </div>
  );
}

function OwnerLink({ threadId }: { threadId: string }) {
  const cache = useSidebarThreads(),
    navigate = useBbNavigate();
  const thread =
    cache.status === "ready"
      ? cache.threads.find((candidate) => candidate.id === threadId)
      : undefined;
  return thread?.href ? (
    <UrlLink
      href={thread.href}
      className="text-xs underline underline-offset-4"
      aria-label="Open owed-by conversation"
    >
      <ThreadTitle threadId={threadId} />
    </UrlLink>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigate.toThread(threadId)}
    >
      Open owed-by conversation
    </Button>
  );
}
