import { useId, useState } from "react";
import { useBrowse } from "./use-browse.ts";
import { useActing } from "./acting-context.ts";
import { commitmentSchema, type CommitmentView } from "./commitment-views.ts";
import { ReadStatus } from "./status.tsx";
import { RadioLink } from "./link.tsx";
import { WorkActionPanel, type WorkRecovery } from "./work-action-panel.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Button } from "../ui/button.tsx";
export function CommitmentReader({
  projectId,
  id,
}: {
  projectId: string;
  id: string;
}) {
  const query = useBrowse(
    projectId,
    { op: "commitment", input: { id } },
    commitmentSchema,
  );
  return (
    <section aria-label="Commitment" className="space-y-3 min-w-0">
      <h2 className="font-medium">Commitment</h2>
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <>
          <p className="text-sm">
            Status: {query.data.status} · Generation {query.data.generation}
          </p>
          <dl className="space-y-1 text-sm break-words">
            <dt>Recipient</dt>
            <dd>
              <code>{query.data.targetId}</code>
            </dd>
            <dt>Owner actor</dt>
            <dd>
              <code>{query.data.ownerActorId}</code>
            </dd>
            <dt>Opening session</dt>
            <dd>
              <code>
                {query.data.openingSessionId ?? "No session recorded"}
              </code>
            </dd>
            <dt>Opened</dt>
            <dd>
              <time dateTime={query.data.openedAt}>
                {new Date(query.data.openedAt).toLocaleString()}
              </time>
            </dd>
            {query.data.closedAt ? (
              <>
                <dt>Closed</dt>
                <dd>
                  <time dateTime={query.data.closedAt}>
                    {new Date(query.data.closedAt).toLocaleString()}
                  </time>
                </dd>
              </>
            ) : null}
          </dl>
          {query.data.result ? (
            <p className="whitespace-pre-wrap break-words">
              Result: {query.data.result}
            </p>
          ) : null}
          {query.data.reason ? (
            <p className="whitespace-pre-wrap break-words">
              Abandonment reason: {query.data.reason}
            </p>
          ) : null}
          <RadioLink
            route={{ projectId, kind: "transmission", id: query.data.txId }}
          >
            Committed request and work history
          </RadioLink>
          <WorkActionPanel txId={query.data.txId} commitmentId={query.data.id}>
            {(recovery) => (
              <CloseWork commitment={query.data!} recovery={recovery} />
            )}
          </WorkActionPanel>
          <p className="text-xs text-muted-foreground">
            Done and abandonment close this commitment independently from
            receipt, ack and reply obligations. An abandoned exclusive request
            stays closed until its original author reopens it; completed work
            cannot be reopened.
          </p>
        </>
      ) : null}
    </section>
  );
}
function CloseWork({
  commitment,
  recovery,
}: {
  commitment: CommitmentView;
  recovery: WorkRecovery;
}) {
  const acting = useActing();
  const id = useId();
  const [result, setResult] = useState(
    recovery.saved?.request.kind === "done"
      ? recovery.saved.request.result
      : "",
  );
  const [reason, setReason] = useState(
    recovery.saved?.request.kind === "abandon"
      ? recovery.saved.request.reason
      : "",
  );
  const owns =
    commitment.ownerActorId === acting.identity?.actorId &&
    (commitment.targetId === acting.identity.actorId ||
      commitment.targetId === acting.identity.sessionId);
  if (!owns)
    return (
      <p className="text-sm text-muted-foreground">
        Select the owning actor or exact addressed session to close this
        commitment. Another owned session stays separate.
      </p>
    );
  if (commitment.status !== "open")
    return (
      <p className="text-sm text-muted-foreground">
        This commitment is closed. Inspect request history for any later claim
        generation.
      </p>
    );
  return (
    <fieldset
      disabled={recovery.blocked}
      className="space-y-3 border-t border-border pt-3"
    >
      <div className="space-y-1">
        <label htmlFor={`${id}-result`} className="text-sm">
          Completion result
        </label>
        <Textarea
          id={`${id}-result`}
          value={result}
          maxLength={400}
          rows={2}
          onChange={(event) => setResult(event.target.value)}
        />
        <Button
          size="sm"
          disabled={recovery.blocked || !result.trim()}
          onClick={() =>
            void recovery.send({
              kind: "done",
              commitmentId: commitment.id,
              result: result.trim(),
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          Mark done
        </Button>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="text-sm">
          Abandonment reason
        </label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={400}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={recovery.blocked || !reason.trim()}
          onClick={() =>
            void recovery.send({
              kind: "abandon",
              commitmentId: commitment.id,
              reason: reason.trim(),
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          Abandon commitment
        </Button>
      </div>
    </fieldset>
  );
}
