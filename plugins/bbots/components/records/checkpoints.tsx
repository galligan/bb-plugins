import type { z } from "zod";
import type { recordsContract } from "../../lib/ui/records-contracts.ts";
import { SettingsGroup } from "../settings/layout.tsx";
import { Button } from "../ui/button.tsx";
import { CheckpointCreate } from "./checkpoint-create.tsx";

type Page = z.infer<typeof recordsContract.botRecords.output>["checkpoints"];
export function CheckpointIndex({
  page,
  pending,
  hasPrevious,
  first,
  more,
  threadId,
  botId,
  active,
  draft,
  onDraftChange,
  inspect,
  inspectRef,
}: {
  page?: Page;
  pending: boolean;
  hasPrevious: boolean;
  first(): void;
  more(cursor: string): void;
  threadId: string;
  botId: string;
  active: boolean;
  draft: { name: string; reason: string };
  onDraftChange(value: { name: string; reason: string }): void;
  inspect(id: string): void;
  inspectRef(id: string, node: HTMLButtonElement | null): void;
}) {
  return (
    <SettingsGroup
      title="Checkpoints"
      description="Named historical selections. Current exclusions apply to exports; a checkpoint is not a complete database backup. Refresh records after creating one."
    >
      {page?.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No named checkpoints yet.
        </p>
      )}
      <div className="divide-y divide-border" aria-label="Checkpoint records">
        {page?.items.map((checkpoint) => (
          <details key={checkpoint.id} className="py-3 text-xs">
            <summary className="cursor-pointer text-sm font-medium">
              {checkpoint.name}
            </summary>
            <dl className="mt-2 space-y-2 break-words text-muted-foreground">
              <div>
                <dt className="font-medium">Saved</dt>
                <dd>{checkpoint.createdAt}</dd>
              </div>
              <div>
                <dt className="font-medium">Attribution</dt>
                <dd>
                  {checkpoint.author} · {checkpoint.reason}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Reference</dt>
                <dd className="break-all">{checkpoint.id}</dd>
              </div>
            </dl>
            <Button
              ref={(node) => inspectRef(checkpoint.id, node)}
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={!active || pending}
              aria-label={`Inspect checkpoint ${checkpoint.name}`}
              onClick={() => inspect(checkpoint.id)}
            >
              Inspect checkpoint
            </Button>
          </details>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {hasPrevious && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={first}
          >
            First checkpoints
          </Button>
        )}
        {page?.nextCursor && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => more(page.nextCursor!)}
          >
            More checkpoints
          </Button>
        )}
      </div>
      <CheckpointCreate
        threadId={threadId}
        botId={botId}
        active={active && !pending}
        draft={draft}
        onDraftChange={onDraftChange}
      />
    </SettingsGroup>
  );
}
