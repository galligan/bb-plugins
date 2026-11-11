import { useState } from "react";
import { z } from "zod";
import { useBrowse } from "./use-browse.ts";
import { responseEventSchema } from "./response-views.ts";
import { pageSchema } from "./view-schemas.ts";
import { ReadStatus } from "./status.tsx";
import { Pagination } from "./pagination.tsx";

export function ResponseHistory({
  projectId,
  txId,
}: {
  projectId: string;
  txId: string;
}) {
  const [cursors, setCursors] = useState([0]);
  const query = useBrowse(
    projectId,
    { op: "responses", input: { txId, after: cursors.at(-1)!, limit: 20 } },
    pageSchema(responseEventSchema, z.number()),
  );
  return (
    <section aria-label="Response history" className="space-y-2">
      <h3 className="font-medium">Response history</h3>
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
              No response events on this page.
            </p>
          ) : (
            <ol className="divide-y divide-border text-sm">
              {query.data.items.map((event) => (
                <li key={event.id} className="space-y-1 py-2 break-words">
                  <p>
                    {event.kind === "standby"
                      ? "Standby (waiting, no commitment)"
                      : event.kind === "received"
                        ? "Explicit receipt confirmation"
                        : event.kind === "ack"
                          ? "Ack"
                          : "Squelch (dismissed, obligations remain)"}{" "}
                    · <code>{event.targetId}</code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>{" "}
                    · Acting session: {event.sessionId ?? "Human endpoint"}
                  </p>
                  {event.kind === "received" ? (
                    <p className="text-xs">
                      {event.payload.evidence === "recipient-confirmation"
                        ? "Recipient-confirmation evidence"
                        : "Receipt provenance unknown"}{" "}
                      · Endpoint:{" "}
                      <code>{event.payload.endpointId ?? "Unknown"}</code>
                    </p>
                  ) : null}
                  {event.payload.reason ? (
                    <p className="whitespace-pre-wrap">
                      {event.payload.reason}
                    </p>
                  ) : null}
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
        </>
      ) : null}
    </section>
  );
}
