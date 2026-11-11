import { RecipientResponseControls } from "./recipient-responses.tsx";
import { ResponseHistory } from "./response-history.tsx";
import { PostingComposer } from "./posting-composer.tsx";
import { z } from "zod";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { transmissionSchema, recipientSchema } from "./view-schemas.ts";
import { useBrowse } from "./use-browse.ts";
import { ReadStatus } from "./status.tsx";
import { RadioLink } from "./link.tsx";

export function TransmissionReader({
  projectId,
  id,
}: {
  projectId: string;
  id: string;
}) {
  const query = useBrowse(
    projectId,
    { op: "read", input: { id } },
    transmissionSchema,
  );
  return (
    <section aria-label="Transmission" className="space-y-3 min-w-0">
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <>
          <p className="whitespace-pre-wrap break-words">{query.data.body}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <RadioLink
              route={{ projectId, kind: "channel", id: query.data.channelId }}
            >
              Channel
            </RadioLink>
            {query.data.replyToId ? (
              <RadioLink
                route={{
                  projectId,
                  kind: "transmission",
                  id: query.data.replyToId,
                }}
              >
                Parent transmission
              </RadioLink>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            <time dateTime={query.data.createdAt}>
              {new Date(query.data.createdAt).toLocaleString()}
            </time>{" "}
            ·{" "}
            {query.data.requestMode === "exclusive"
              ? "Exclusive request"
              : "Discussion"}
            {query.data.requireAck ? " · Ack requested" : ""}
            {query.data.expectReply ? " · Reply requested" : ""}
          </p>
          {query.data.replyForId ? (
            <p className="text-sm">
              This reply covers one recipient:{" "}
              <code className="break-all">{query.data.replyForId}</code>
            </p>
          ) : null}
          {query.data.refs.length ? (
            <ul aria-label="References" className="space-y-2 text-sm">
              {query.data.refs.map((ref, index) => (
                <li key={index}>
                  {ref.kind === "url" ? (
                    <UrlLink href={ref.url}>{ref.label ?? ref.url}</UrlLink>
                  ) : ref.kind === "dispatch" ? (
                    <RadioLink
                      route={{
                        projectId,
                        kind: "dispatch",
                        id: ref.id,
                        revision: ref.revision,
                      }}
                    >
                      Dispatch{ref.revision ? ` revision ${ref.revision}` : ""}
                    </RadioLink>
                  ) : ref.kind === "transmission" || ref.kind === "channel" ? (
                    <RadioLink
                      route={{ projectId, kind: ref.kind, id: ref.id }}
                    >
                      {ref.kind === "channel"
                        ? "Referenced channel"
                        : "Referenced transmission"}
                    </RadioLink>
                  ) : (
                    <span>
                      Participant <code className="break-all">{ref.id}</code>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <RecipientResponses projectId={projectId} txId={id} />
          <ResponseHistory projectId={projectId} txId={id} />
          <RecipientResponseControls
            txId={id}
            recipientIds={query.data.recipientIds}
          />
          <PostingComposer
            projectId={projectId}
            channelId={query.data.channelId}
            parent={query.data}
          />
          {query.data.audiences.length ? (
            <p className="text-xs text-muted-foreground">
              Broadcast snapshots:{" "}
              {query.data.audiences
                .map((a) => `${a.eligibleCount} eligible in ${a.channelId}`)
                .join("; ")}
              . These are accepted audience counts, not receipt evidence.
            </p>
          ) : null}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Canonical identities</summary>
            <dl className="space-y-1 break-all">
              <dt>Transmission</dt>
              <dd>{query.data.id}</dd>
              <dt>Author</dt>
              <dd>{query.data.authorId}</dd>
              <dt>Acting session</dt>
              <dd>{query.data.sessionId ?? "No session recorded"}</dd>
            </dl>
          </details>
        </>
      ) : null}
    </section>
  );
}
function RecipientResponses({
  projectId,
  txId,
}: {
  projectId: string;
  txId: string;
}) {
  const query = useBrowse(
    projectId,
    { op: "response-summary", input: { txId } },
    z.array(recipientSchema),
  );
  return (
    <section aria-label="Recipient responses" className="space-y-2">
      <h3 className="font-medium">Recipient responses</h3>
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No addressed recipients. No delivery is implied.
        </p>
      ) : null}
      {query.data ? (
        <ul className="divide-y divide-border">
          {query.data.map((recipient) => (
            <li key={recipient.targetId} className="py-2 space-y-1">
              <code className="text-xs break-all">{recipient.targetId}</code>
              <p className="text-sm">
                {recipient.receivedEndpoints
                  ? `Received confirmed at ${recipient.receivedEndpoints} endpoint${recipient.receivedEndpoints === 1 ? "" : "s"}`
                  : "Receipt unknown"}{" "}
                · {recipient.ackAt ? "Ack recorded" : "No ack recorded"} ·{" "}
                {recipient.standbyAt
                  ? "Standby recorded (no commitment)"
                  : "No standby recorded"}
                {recipient.squelchAt ? " · Squelched" : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Each canonical recipient is independent. Receipt, ack, reply coverage
        and work commitments are separate facts.
      </p>
    </section>
  );
}
