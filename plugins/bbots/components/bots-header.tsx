import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { botRoute } from "../lib/ui/route.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { ResourceActionButton } from "./ui/resource/row.tsx";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./ui/coarse-pointer-sizing.ts";

export function BotsHeader({ subPath }: PluginNavPanelProps) {
  const route = botRoute(subPath),
    navigate = useBbNavigate();
  const visible = usePageVisible();
  const query = useRpcQuery({
    contract: managementContract,
    method: "list",
    input: {},
    enabled: visible && route.page === "list",
  });
  return (
    <div className="flex items-center gap-1">
      {route.page === "list" ? (
        <>
          <ResourceActionButton
            label="Refresh bots"
            icon="RotateCcw"
            loading={query.isFetching}
            disabled={!visible || query.isFetching}
            className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
            onClick={() => void query.refetch()}
          />
          <ResourceActionButton
            label="New bot"
            icon="Plus"
            className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
            onClick={() => navigate.toPluginPanel("bots", { subPath: "new" })}
          />
        </>
      ) : (
        <>
          <ResourceActionButton
            label="Back to bots"
            icon="ArrowLeft"
            className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
            onClick={() => navigate.toPluginPanel("bots")}
          />
          {route.page === "detail" && (
            <ResourceActionButton
              label="Bot settings"
              icon="Settings"
              className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
              onClick={() =>
                navigate.toPluginPanel("bots", {
                  subPath: `${route.botId}/settings`,
                })
              }
            />
          )}
          {route.page === "settings" && (
            <ResourceActionButton
              label="Bot overview"
              icon="Bot"
              className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
              onClick={() =>
                navigate.toPluginPanel("bots", { subPath: route.botId })
              }
            />
          )}
        </>
      )}
    </div>
  );
}

export function useBotsTitle({ subPath }: PluginNavPanelProps) {
  const route = botRoute(subPath);
  const visible = usePageVisible();
  const query = useRpcQuery({
    contract: managementContract,
    method: "show",
    input: { botId: "botId" in route ? route.botId : "none" },
    enabled: visible && "botId" in route,
  });
  if (route.page === "list") return null;
  const root = { label: "Bots", to: "/plugins/bbots/bots" };
  if (route.page === "new")
    return { breadcrumbs: [root, { label: "New bot" }] };
  if (route.page === "invalid") return { title: "Bots" };
  const bot = {
    label: query.data?.bot.name ?? "Bot",
    to: `/plugins/bbots/bots/${encodeURIComponent(route.botId)}`,
  };
  return {
    breadcrumbs: [
      root,
      ...(route.page === "settings"
        ? [bot, { label: "Settings" }]
        : [{ label: bot.label }]),
    ],
  };
}
