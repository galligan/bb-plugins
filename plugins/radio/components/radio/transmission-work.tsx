import { useId, useState } from "react";
import { z } from "zod";
import { useActing } from "./acting-context.ts";
import { useBrowse } from "./use-browse.ts";
import { commitmentEventSchema } from "./commitment-views.ts";
import { transmissionSchema, pageSchema } from "./view-schemas.ts";
import { WorkActionPanel, type WorkRecovery } from "./work-action-panel.tsx";
import { RadioLink } from "./link.tsx";
import { ReadStatus } from "./status.tsx";
import { Pagination } from "./pagination.tsx";
import { Button } from "../ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
type TransmissionView = z.infer<typeof transmissionSchema>;
export function TransmissionWork({
  projectId,
  tx,
}: {
  projectId: string;
  tx: TransmissionView;
}) {
  const [cursors, setCursors] = useState([0]);
  const query = useBrowse(
    projectId,
    {
      op: "commitment-events",
      input: { txId: tx.id, after: cursors.at(-1)!, limit: 20 },
    },
    pageSchema(commitmentEventSchema, z.number()),
  );
  const latest =
    query.data && !query.data.hasMore ? query.data.items.at(-1) : undefined;
  return (
    <section
      aria-label="Work history"
      className="space-y-3 border-t border-border pt-4"
    >
      <h3 className="font-medium">Work history</h3>
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <>
          {!query.data.items.length ? (
            <p className="text-sm text-muted-foreground">
              No work events on this page.
            </p>
          ) : (
            <ol className="divide-y divide-border text-sm">
              {query.data.items.map((event) => (
                <li key={event.id} className="space-y-1 py-2">
                  <p>
                    {event.kind} · Generation {event.payload.generation} ·{" "}
                    <RadioLink
                      route={{
                        projectId,
                        kind: "commitment",
                        id: event.commitmentId,
                      }}
                    >
                      Inspect commitment
                    </RadioLink>
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    Actor: {event.actorId} · Session:{" "}
                    {event.sessionId ?? "No session recorded"} ·{" "}
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          )}
          <Pagination
            pending={query.isFetching}
            canBack={cursors.length > 1}
            hasMore={query.data.hasMore}
            next={() => setCursors((old) => [...old, query.data!.nextCursor])}
            back={() => setCursors((old) => old.slice(0, -1))}
            refresh={query.refetch}
          />
          {query.data.hasMore ? (
            <p className="text-xs text-muted-foreground">
              Later work events remain. Go to the latest page before assessing
              whether an abandoned exclusive request can be reopened.
            </p>
          ) : null}
        </>
      ) : null}
      <WorkActionPanel txId={tx.id}>
        {(recovery) => (
          <AcceptOrReopen
            key={tx.id}
            tx={tx}
            recovery={recovery}
            latest={latest}
          />
        )}
      </WorkActionPanel>
    </section>
  );
}
function AcceptOrReopen({
  tx,
  recovery,
  latest,
}: {
  tx: TransmissionView;
  recovery: WorkRecovery;
  latest?: z.infer<typeof commitmentEventSchema>;
}) {
  const acting = useActing();
  const id = useId();
  const own = [acting.identity!.actorId, acting.identity!.sessionId].filter(
    (target): target is string => !!target,
  );
  const targets =
    tx.requestMode === "exclusive" && tx.recipientIds.length
      ? own.filter((target) => tx.recipientIds.includes(target))
      : own;
  const [targetId, setTarget] = useState(
    recovery.saved?.request.kind === "wilco"
      ? recovery.saved.request.targetId
      : targets.length === 1
        ? targets[0]!
        : "",
  );
  const exclusiveClosed =
    tx.requestMode === "exclusive" &&
    !!latest &&
    ["done", "abandon"].includes(latest.kind);
  return (
    <div className="space-y-3">
      <fieldset
        disabled={recovery.blocked || exclusiveClosed}
        className="space-y-2 min-w-0"
      >
        <label htmlFor={`${id}-target`} className="text-sm">
          Accept work for
        </label>
        <Select
          value={targetId || undefined}
          disabled={recovery.blocked || exclusiveClosed || !targets.length}
          onValueChange={setTarget}
        >
          <SelectTrigger id={`${id}-target`} className="w-full">
            <SelectValue placeholder="Choose one recipient" />
          </SelectTrigger>
          <SelectContent>
            {targets.map((target) => (
              <SelectItem key={target} value={target}>
                {target === acting.identity!.actorId
                  ? acting.mode === "operator"
                    ? "Human"
                    : "Actor"
                  : "Acting session"}{" "}
                · {target}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={
            recovery.blocked || exclusiveClosed || !targets.includes(targetId)
          }
          onClick={() =>
            void recovery.send({
              kind: "wilco",
              txId: tx.id,
              targetId,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          Record wilco (accept work)
        </Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Wilco creates an explicit work commitment for one recipient. It does not
        record receipt, ack or a reply, and it starts no agent.
        {tx.requestMode === "exclusive"
          ? " The server accepts one exclusive claimant at a time."
          : ""}
      </p>
      {exclusiveClosed ? (
        <p className="text-sm text-muted-foreground">
          {latest?.kind === "done"
            ? "This exclusive request completed; create a new transmission for new work."
            : "This exclusive request was abandoned and stays closed until its original author reopens it."}
        </p>
      ) : null}
      {tx.requestMode === "exclusive" &&
      tx.authorId === acting.identity!.actorId &&
      latest?.kind === "abandon" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={recovery.blocked}
          onClick={() =>
            void recovery.send({
              kind: "reopen",
              txId: tx.id,
              expectedCommitmentId: latest.commitmentId,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          Reopen abandoned exclusive request
        </Button>
      ) : null}
    </div>
  );
}
