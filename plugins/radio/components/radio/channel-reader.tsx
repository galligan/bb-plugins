import { useState } from "react";
import { z } from "zod";
import { useBrowse } from "./use-browse.ts";
import {
  pageSchema,
  summarySchema,
  dispatchTitleSchema,
} from "./view-schemas.ts";
import { RadioLink } from "./link.tsx";
import { ReadStatus } from "./status.tsx";
import { Pagination } from "./pagination.tsx";

export function ChannelReader({
  projectId,
  channelId,
}: {
  projectId: string;
  channelId: string;
}) {
  return (
    <div className="space-y-6">
      <History projectId={projectId} channelId={channelId} />
      <Documents projectId={projectId} channelId={channelId} />
    </div>
  );
}
function History({
  projectId,
  channelId,
}: {
  projectId: string;
  channelId: string;
}) {
  const [cursors, setCursors] = useState([0]);
  const query = useBrowse(
    projectId,
    { op: "scan", input: { channelId, after: cursors.at(-1)!, limit: 20 } },
    pageSchema(summarySchema, z.number()),
  );
  return (
    <section aria-label="Transmissions" className="space-y-2">
      <h2 className="text-base font-medium">Transmissions</h2>
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
              No transmissions on this page.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {query.data.items.map((tx) => (
                <li key={tx.id} className="py-3 space-y-1 min-w-0">
                  <RadioLink
                    route={{ projectId, kind: "transmission", id: tx.id }}
                  >
                    <span className="whitespace-pre-wrap break-words">
                      {tx.body}
                    </span>
                  </RadioLink>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={tx.createdAt}>
                      {new Date(tx.createdAt).toLocaleString()}
                    </time>
                    {tx.replyToId ? " · Reply" : ""}
                    {tx.requireAck ? " · Ack requested" : ""}
                    {tx.expectReply ? " · Reply requested" : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <Pagination
            canBack={cursors.length > 1}
            hasMore={query.data.hasMore}
            pending={query.isFetching}
            next={() => setCursors((old) => [...old, query.data!.nextCursor])}
            back={() => setCursors((old) => old.slice(0, -1))}
            refresh={query.refetch}
          />
        </>
      ) : null}
    </section>
  );
}
function Documents({
  projectId,
  channelId,
}: {
  projectId: string;
  channelId: string;
}) {
  const [cursors, setCursors] = useState([0]);
  const query = useBrowse(
    projectId,
    {
      op: "dispatch-list",
      input: { channelId, after: cursors.at(-1)!, limit: 20 },
    },
    pageSchema(dispatchTitleSchema, z.number()),
  );
  return (
    <section aria-label="Dispatches" className="space-y-2">
      <h2 className="text-base font-medium">Dispatches</h2>
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
              No dispatches on this page.
            </p>
          ) : (
            <ul className="space-y-2">
              {query.data.items.map((doc) => (
                <li key={doc.id}>
                  <RadioLink
                    route={{
                      projectId,
                      kind: "dispatch",
                      id: doc.id,
                      revision: doc.revision,
                    }}
                  >
                    {doc.title}
                  </RadioLink>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · revision {doc.revision}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            canBack={cursors.length > 1}
            hasMore={query.data.hasMore}
            pending={query.isFetching}
            next={() => setCursors((old) => [...old, query.data!.nextCursor])}
            back={() => setCursors((old) => old.slice(0, -1))}
            refresh={query.refetch}
          />
        </>
      ) : null}
    </section>
  );
}
