import {
  Markdown,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { recordsContract } from "../../lib/ui/records-contracts.ts";
import { Button } from "../ui/button.tsx";

export function MemoryNote({
  threadId,
  botId,
  id,
  active,
  back,
}: {
  threadId: string;
  botId: string;
  id: string;
  active: boolean;
  back(): void;
}) {
  const query = useRpcQuery({
    contract: recordsContract,
    method: "botMemory",
    input: { threadId, id },
    enabled: active,
  });
  const state =
    query.data?.threadId === threadId && query.data.botId === botId
      ? query.data
      : undefined;
  return (
    <div className="space-y-3 text-sm">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!active}
        onClick={back}
      >
        Back to memory list
      </Button>
      {query.isLoading && <p role="status">Reading memory…</p>}
      {query.error && (
        <div role="alert">
          <p>Could not read this memory. Its current content is unknown.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!active || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry memory read
          </Button>
        </div>
      )}
      {!query.error && state?.availability === "suppressed" && (
        <p role="status">
          This memory is excluded from new retrieval. Retained history and
          previous live context are not erased by this view.
        </p>
      )}
      {!query.error && state?.availability === "available" && (
        <article className="min-w-0 space-y-3 break-words">
          <h2 className="text-sm font-semibold">{state.note.topic}</h2>
          <p className="text-xs text-muted-foreground">
            Revision {state.note.revision} · {state.note.kind} ·{" "}
            {state.note.basis === "fact" ? "Recorded as fact" : "Inference"}
          </p>
          <Markdown content={state.note.markdown} />
          <p className="text-xs text-muted-foreground">
            Relative file links use this conversation's native context. Use the
            evidence references to locate original material.
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              Evidence sources ({state.note.sourceCount})
            </summary>
            <ul className="mt-2 space-y-1">
              {state.note.sources.map((source, i) => (
                <li key={i} className="break-all">
                  {source}
                </li>
              ))}
            </ul>
            {state.note.sourceCount > state.note.sources.length && (
              <p className="mt-2">
                Showing the first {state.note.sources.length} sources.
              </p>
            )}
          </details>
        </article>
      )}
    </div>
  );
}
