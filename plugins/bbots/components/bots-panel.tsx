import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { botRoute, type BotRoute } from "../lib/ui/route.ts";
import { useMachines } from "../lib/ui/use-machines.ts";
import { CreateBot } from "./create-bot.tsx";
import { BotDetail } from "./bot-detail.tsx";
import { BotCollection } from "./bot-collection.tsx";
import { BotSettings } from "./bot-settings.tsx";
import { Button } from "./ui/button.tsx";
export type { Machine } from "../lib/ui/use-machines.ts";

function BotPage({
  route,
}: {
  route: Extract<BotRoute, { page: "detail" | "settings" }> | { page: "new" };
}) {
  const hosts = useMachines();
  return (
    <div className="space-y-4">
      {hosts.error && (
        <div role="alert" className="text-xs text-destructive">
          <p>
            Could not check machines. Refresh before creating or resuming a bot.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={hosts.refresh}
          >
            Refresh machines
          </Button>
        </div>
      )}
      {route.page === "new" ? (
        <CreateBot machines={hosts.machines} unavailable={hosts.unavailable} />
      ) : route.page === "settings" ? (
        <BotSettings key={route.botId} botId={route.botId} />
      ) : (
        <BotDetail
          key={route.botId}
          botId={route.botId}
          machines={hosts.machines}
          hostsUnavailable={hosts.unavailable}
        />
      )}
    </div>
  );
}
export function BotsPanel({ subPath }: PluginNavPanelProps) {
  const route = botRoute(subPath);
  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto text-sm text-foreground">
      <div className="mx-auto w-full max-w-[760px] space-y-6 px-4 pb-8 pt-4 md:px-5">
        {route.page === "list" ? (
          <BotCollection />
        ) : route.page === "invalid" ? (
          <p role="alert" className="text-xs text-destructive">
            This bot link is invalid. Return to Bots and select a collaborator.
          </p>
        ) : (
          <BotPage route={route} />
        )}
      </div>
    </div>
  );
}
