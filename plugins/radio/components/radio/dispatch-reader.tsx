import { Markdown } from "@get-bb/plugin-sdk/app";
import { dispatchSchema } from "./view-schemas.ts";
import { useBrowse } from "./use-browse.ts";
import { ReadStatus } from "./status.tsx";
import { RadioLink } from "./link.tsx";

export function DispatchReader({
  projectId,
  id,
  revision,
}: {
  projectId: string;
  id: string;
  revision?: number;
}) {
  const query = useBrowse(
    projectId,
    { op: "dispatch-read", input: { id, ...(revision ? { revision } : {}) } },
    dispatchSchema,
  );
  return (
    <section aria-label="Dispatch" className="space-y-3 min-w-0">
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <>
          <h2 className="text-lg font-medium break-words">
            {query.data.title}
          </h2>
          <p className="text-sm text-muted-foreground">
            Revision {query.data.revision} ·{" "}
            {revision ? "Pinned revision" : "Latest revision at this read"}
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <RadioLink
              route={{ projectId, kind: "channel", id: query.data.channelId }}
            >
              Channel
            </RadioLink>
            {revision ? (
              <RadioLink route={{ projectId, kind: "dispatch", id }}>
                Read latest
              </RadioLink>
            ) : (
              <RadioLink
                route={{
                  projectId,
                  kind: "dispatch",
                  id,
                  revision: query.data.revision,
                }}
              >
                Link to this revision
              </RadioLink>
            )}
          </div>
          <Markdown
            content={query.data.markdown}
            className="min-w-0 break-words"
          />
          <p className="text-xs text-muted-foreground">
            References are not fetched automatically. Reading a dispatch does
            not confirm transmission receipt.
          </p>
        </>
      ) : null}
    </section>
  );
}
