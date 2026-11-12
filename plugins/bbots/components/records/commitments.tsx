import { useState } from "react";
import { experimental_useRpcQuery as useRpcQuery } from "@get-bb/plugin-sdk/app";
import { commitmentUiContract } from "../../lib/ui/commitment-contracts.ts";
import { SettingsGroup } from "../settings/layout.tsx";
import { Button } from "../ui/button.tsx";
import { CommitmentDetail } from "./commitment-detail.tsx";

export function CommitmentIndex({
  threadId,
  botId,
  active,
}: {
  threadId: string;
  botId: string;
  active: boolean;
}) {
  const [after, setAfter] = useState<string>(),
    [selected, setSelected] = useState<string | null>(null);
  const query = useRpcQuery({
    contract: commitmentUiContract,
    method: "botCommitments",
    input: { threadId, ...(after ? { after } : {}) },
    enabled: active,
  });
  const page =
    !query.error &&
    query.data?.threadId === threadId &&
    query.data.botId === botId
      ? query.data
      : undefined;
  return (
    <SettingsGroup
      title="Commitments"
      description="What is owed and who owns it. Linked status belongs to its task source; the list does not check or copy it."
    >
      {query.isLoading && <p role="status">Reading commitments…</p>}
      {query.error && (
        <p role="alert" className="text-xs text-destructive">
          Could not read commitments. Their current state is unknown; refresh
          before relying on this view.
        </p>
      )}
      {page?.records.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No commitments on this page.
        </p>
      )}
      <div className="divide-y divide-border" aria-label="Commitment records">
        {page?.records.map((record) => (
          <article key={record.id} className="space-y-2 py-3">
            <p className="whitespace-pre-wrap break-words text-sm">
              {record.excerpt}
            </p>
            <p className="text-xs text-muted-foreground">
              {record.localStatus
                ? `Manual obligation · ${record.localStatus}`
                : `${record.referenceKind === "tasks" ? "Tasks" : "Markdown"} · status not checked`}{" "}
              · Revision {record.revision} · {record.evidenceCount} evidence
              references
            </p>
            <details
              open={selected === record.id}
              onToggle={(event) => {
                if (!active) return;
                const open = event.currentTarget.open;
                setSelected((current) =>
                  open ? record.id : current === record.id ? null : current,
                );
              }}
            >
              <summary
                role="button"
                className="cursor-pointer text-xs font-medium"
                aria-label={`Inspect commitment ${record.excerpt.slice(0, 128)}`}
              >
                Inspect obligation
              </summary>
              {selected === record.id && (
                <div className="mt-3">
                  <CommitmentDetail
                    threadId={threadId}
                    botId={botId}
                    id={record.id}
                    active={active}
                  />
                </div>
              )}
            </details>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!active || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.error ? "Retry commitments read" : "Refresh commitments"}
        </Button>
        <div className="flex flex-wrap gap-2">
          {after && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active || query.isFetching}
              onClick={() => {
                setSelected(null);
                setAfter(undefined);
              }}
            >
              First commitments
            </Button>
          )}
          {page?.nextCursor && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!active || query.isFetching}
              onClick={() => {
                setSelected(null);
                setAfter(page.nextCursor!);
              }}
            >
              More commitments
            </Button>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
