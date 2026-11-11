import { useEffect, useState } from "react";
import {
  useSdk,
  useBbNavigate,
  useRealtimeConnectionState,
  experimental_useRpcQuery as useRpcQuery,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { Button } from "./ui/button.tsx";
import { CreateBot } from "./create-bot.tsx";
import { BotDetail } from "./bot-detail.tsx";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";

export type Machine = { id: string; name: string; status: string };
export function BotsPanel({ subPath }: PluginNavPanelProps) {
  const sdk = useSdk(),
    navigate = useBbNavigate(),
    connection = useRealtimeConnectionState();
  const visible = usePageVisible();
  const list = useRpcQuery({
    contract: managementContract,
    method: "list",
    input: {},
    enabled: visible,
  });
  const [machines, setMachines] = useState<Machine[]>([]);
  const [hostError, setHostError] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoadingHosts(true);
    sdk.hosts
      .list({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) {
          setMachines(rows);
          setHostError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setHostError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHosts(false);
      });
    return () => controller.abort();
  }, [sdk, visible, connection, refresh]);
  let selected: string | null = null;
  let invalidPath = false;
  if (subPath && subPath !== "new") {
    try {
      selected = decodeURIComponent(subPath);
    } catch {
      invalidPath = true;
    }
  }
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto p-4 text-foreground md:p-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => navigate.toPluginPanel("bots", { subPath: "new" })}
          >
            New bot
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!visible || list.isFetching || loadingHosts}
            onClick={() => {
              void list.refetch();
              setRefresh((n) => n + 1);
            }}
          >
            Refresh
          </Button>
        </div>
        {list.isLoading && <p role="status">Loading bots…</p>}
        {list.error && (
          <p role="alert" className="text-destructive">
            Could not load bots. Check the connection and refresh.
          </p>
        )}
        {hostError && (
          <p role="alert" className="text-destructive">
            Could not check machines. Refresh before creating or resuming a bot.
          </p>
        )}
        {!list.error && list.data?.bots.length === 0 && (
          <p>No bots yet. Create Bob or choose another name.</p>
        )}
        <ul className="space-y-1" aria-label="Bots">
          {list.data?.bots.map((bot) => (
            <li key={bot.id}>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={selected === bot.id}
                className="h-auto min-h-9 max-w-full whitespace-normal break-words text-left max-md:pointer-coarse:min-h-11"
                onClick={() =>
                  navigate.toPluginPanel("bots", { subPath: bot.id })
                }
              >
                {bot.name}
              </Button>
            </li>
          ))}
        </ul>
        {list.data?.hasMore && (
          <p>
            Showing the first 100 bots. Open a known bot directly; larger
            collection paging is not available yet.
          </p>
        )}
        {invalidPath && (
          <p role="alert">
            This bot link is invalid. Select a bot from the list.
          </p>
        )}
        {subPath === "new" ? (
          <CreateBot
            machines={machines}
            unavailable={!visible || hostError || loadingHosts}
          />
        ) : selected ? (
          <BotDetail
            key={selected}
            botId={selected}
            machines={machines}
            hostsUnavailable={!visible || hostError || loadingHosts}
          />
        ) : (
          <p>Select a bot to open its ongoing conversation.</p>
        )}
      </div>
    </main>
  );
}
