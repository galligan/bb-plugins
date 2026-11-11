import { CommitmentReader } from "./commitment-reader.tsx";
import { ActingProvider } from "./acting-provider.tsx";
import { useState } from "react";
import { useBbContext, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { ProjectPicker } from "./project-picker.tsx";
import { useBrowse } from "./use-browse.ts";
import { readRoute, type RadioRoute } from "./routes.ts";
import { RadioLink } from "./link.tsx";
import { channelSchema, pageSchema } from "./view-schemas.ts";
import { ReadStatus } from "./status.tsx";
import { Pagination } from "./pagination.tsx";
import { ChannelReader } from "./channel-reader.tsx";
import { TransmissionReader } from "./transmission-reader.tsx";
import { DispatchReader } from "./dispatch-reader.tsx";

export function RadioPanel({ subPath }: PluginNavPanelProps) {
  const context = useBbContext();
  const route = readRoute(subPath);
  const projectId =
    route?.projectId ?? (!subPath ? (context.projectId ?? "") : "");
  return (
    <div className="h-full min-w-0 overflow-auto p-4 space-y-4 text-foreground">
      <ProjectPicker projectId={projectId} />
      {subPath && !route ? (
        <p role="alert" className="text-destructive">
          This Radio link is invalid. Choose a project to continue.
        </p>
      ) : null}
      {!projectId ? (
        <p className="text-sm text-muted-foreground">
          Choose a project to read its channels. Reading does not confirm
          receipt or accept work.
        </p>
      ) : (
        <ActingProvider key={projectId} projectId={projectId}>
          <ProjectReader route={route ?? { projectId }} />
        </ActingProvider>
      )}
    </div>
  );
}
function ProjectReader({ route }: { route: RadioRoute }) {
  const [cursors, setCursors] = useState([""]);
  const after = cursors.at(-1)!;
  const query = useBrowse(
    route.projectId,
    { op: "channels", input: { after, limit: 50 } },
    pageSchema(channelSchema, z.string()),
  );
  const channelId =
    route.kind === "channel" ? route.id : query.project?.channelId;
  return (
    <>
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <>
          <nav
            aria-label="Radio channels"
            className="flex flex-wrap gap-x-4 gap-y-2 text-sm"
          >
            {query.data.items.map((channel) => (
              <RadioLink
                key={channel.id}
                route={{
                  projectId: route.projectId,
                  kind: "channel",
                  id: channel.id,
                }}
              >
                {channel.parentId
                  ? `${query.project?.name}/${channel.name}`
                  : (query.project?.name ?? channel.name)}
              </RadioLink>
            ))}
          </nav>
          {query.data.hasMore || cursors.length > 1 ? (
            <Pagination
              pending={query.isFetching}
              canBack={cursors.length > 1}
              hasMore={query.data.hasMore}
              next={() => setCursors((old) => [...old, query.data!.nextCursor])}
              back={() => setCursors((old) => old.slice(0, -1))}
              refresh={query.refetch}
            />
          ) : null}
        </>
      ) : null}
      {route.kind === "commitment" ? (
        <CommitmentReader
          key={route.id}
          projectId={route.projectId}
          id={route.id!}
        />
      ) : route.kind === "transmission" ? (
        <TransmissionReader
          key={route.id}
          projectId={route.projectId}
          id={route.id!}
        />
      ) : route.kind === "dispatch" ? (
        <DispatchReader
          key={`${route.id}:${route.revision ?? "latest"}`}
          projectId={route.projectId}
          id={route.id!}
          revision={route.revision}
        />
      ) : channelId ? (
        <ChannelReader
          key={channelId}
          projectId={route.projectId}
          channelId={channelId}
        />
      ) : null}
    </>
  );
}
