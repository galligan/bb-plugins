import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { ResourceRow } from "./ui/resource/row.tsx";
import { Icon } from "./ui/icon.tsx";
import { EmptyState, EmptyStatePanel } from "./ui/empty-state.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { Button } from "./ui/button.tsx";

export function BotCollection() {
  const navigate = useBbNavigate(),
    visible = usePageVisible();
  const query = useRpcQuery({
    contract: managementContract,
    method: "list",
    input: {},
    enabled: visible,
  });
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        Your persistent collaborators and their ongoing conversations.
      </p>
      {query.isLoading && (
        <div role="status" aria-label="Loading bots" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {query.error && (
        <EmptyStatePanel>
          <EmptyState
            icon="AlertTriangle"
            message="Could not load bots. Check the connection and refresh."
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={!visible || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry bot read
          </Button>
        </EmptyStatePanel>
      )}
      {!query.error && query.data?.bots.length === 0 && (
        <EmptyStatePanel>
          <EmptyState
            icon="Bot"
            message="No bots yet. Create Bob or choose another name."
          />
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => navigate.toPluginPanel("bots", { subPath: "new" })}
          >
            New bot
          </Button>
        </EmptyStatePanel>
      )}
      <div className="divide-y divide-border" aria-label="Bots">
        {query.data?.bots.map((bot) => (
          <ResourceRow
            key={bot.id}
            leading={
              <Icon name="Bot" className="size-4 text-muted-foreground" />
            }
            title={bot.name}
            openLabel={`Open ${bot.name}`}
            onOpen={() => navigate.toPluginPanel("bots", { subPath: bot.id })}
          />
        ))}
      </div>
      {query.data?.hasMore && (
        <p className="text-xs text-muted-foreground">
          Showing the first 100 bots. Open a known bot directly; larger
          collection paging is not available yet.
        </p>
      )}
    </div>
  );
}
