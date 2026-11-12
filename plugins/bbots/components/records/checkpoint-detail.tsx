import type { Ref } from "react";
import {
  Markdown,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { checkpointInspectContract } from "../../lib/ui/checkpoint-inspect.ts";
import { Button } from "../ui/button.tsx";

export function CheckpointDetail({
  threadId,
  botId,
  id,
  after,
  active,
  back,
  backRef,
  page,
}: {
  threadId: string;
  botId: string;
  id: string;
  after?: string;
  active: boolean;
  back(): void;
  backRef?: Ref<HTMLButtonElement>;
  page(after?: string): void;
}) {
  const query = useRpcQuery({
    contract: checkpointInspectContract,
    method: "botCheckpoint",
    input: { threadId, expectedBotId: botId, id, ...(after ? { after } : {}) },
    enabled: active,
  });
  const state =
    query.data?.threadId === threadId &&
    query.data.botId === botId &&
    query.data.checkpoint.id === id &&
    query.data.checkpoint.botId === botId &&
    query.data.after === (after ?? null) &&
    !query.error
      ? query.data
      : undefined;
  const error = Boolean(query.error) || Boolean(query.data && !state);
  return (
    <div className="min-w-0 space-y-3 break-words text-sm">
      <Button
        ref={backRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={!active}
        onClick={back}
      >
        Back to checkpoints
      </Button>
      <p className="text-xs text-muted-foreground">
        Historical selections, one retrievable document per page. Each read
        applies current forgetting exclusions. Inspection does not restore
        settings, refresh live context or start work. Relative file links use
        this conversation's native context; evidence identifies original
        material.
      </p>
      {query.isLoading && <p role="status">Reading checkpoint…</p>}
      {error && (
        <div role="alert">
          <p>
            Could not read this checkpoint page. Its selected content is
            unknown.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!active || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry checkpoint read
          </Button>
        </div>
      )}
      {state && (
        <>
          <h2 className="text-sm font-semibold">{state.checkpoint.name}</h2>
          <dl className="space-y-2 text-xs text-muted-foreground">
            <div>
              <dt className="font-medium">Saved profile</dt>
              <dd>
                @{state.profile.name} · Revision {state.profile.revision}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Saved</dt>
              <dd>{state.checkpoint.createdAt}</dd>
            </div>
            <div>
              <dt className="font-medium">Attribution</dt>
              <dd>
                {state.checkpoint.author} · {state.checkpoint.reason}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Original selection</dt>
              <dd>
                {state.selectedDocuments} documents before current exclusions
              </dd>
            </div>
          </dl>
          {state.document ? (
            <article className="space-y-3 border-t border-border pt-3">
              <h3 className="text-sm font-medium">{state.document.topic}</h3>
              <p className="text-xs text-muted-foreground">
                Saved revision {state.document.revision} ·{" "}
                {state.document.kind === "soul"
                  ? "SOUL"
                  : state.document.basis === "fact"
                    ? "Recorded as fact"
                    : "Inference"}
              </p>
              <Markdown content={state.document.markdown} />
              <p className="text-xs text-muted-foreground">
                {state.document.author} · {state.document.reason} ·{" "}
                {state.document.createdAt}
              </p>
              {state.document.kind === "knowledge" && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Evidence sources ({state.document.sourceCount})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {state.document.sources.map((source, i) => (
                      <li key={i} className="break-all">
                        {source}
                      </li>
                    ))}
                  </ul>
                  {state.document.sourceCount >
                    state.document.sources.length && (
                    <p className="mt-2">
                      Showing the first {state.document.sources.length} sources.
                    </p>
                  )}
                </details>
              )}
            </article>
          ) : (
            <p role="status">
              No retrievable selected document on this page. Current exclusions
              may suppress saved knowledge.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active || query.isFetching}
              onClick={() => void query.refetch()}
            >
              Refresh checkpoint page
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active || query.isFetching || !after}
              onClick={() => page()}
            >
              First selected document
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active || query.isFetching || !state.nextCursor}
              onClick={() => {
                if (state.nextCursor) page(state.nextCursor);
              }}
            >
              Next selected document
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
