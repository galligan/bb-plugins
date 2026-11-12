import { useEffect, useId, useState } from "react";
import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { IdentitySettings } from "./settings/identity.tsx";
import { SoulSettings } from "./settings/soul.tsx";
import { DefaultSettings } from "./settings/defaults.tsx";
import { Button } from "./ui/button.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import {
  SettingsGroup,
  SettingRow,
  SETTINGS_CONTROL_CLASS,
} from "./settings/layout.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.tsx";

export function BotSettings({ botId }: { botId: string }) {
  const navigate = useBbNavigate(),
    visible = usePageVisible();
  const query = useRpcQuery({
    contract: managementContract,
    method: "show",
    input: { botId },
    enabled: visible,
  });
  return (
    <div className="space-y-6">
      {query.isLoading && (
        <div role="status" aria-label="Loading bot settings">
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {query.error && (
        <div role="alert">
          <p className="text-xs text-destructive">
            Could not read this bot's settings.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry settings read
          </Button>
        </div>
      )}
      {query.data && (
        <>
          <IdentitySettings
            key={botId}
            bot={query.data.bot}
            reread={() => void query.refetch()}
          />
          <DefaultSettings
            botId={botId}
            hostId={query.data.setup.request.hostId}
          />
          <SoulSettings key={`soul:${botId}`} botId={botId} />
          <SettingsGroup
            title="Conversation"
            description="Use the native conversation controls to change its current model and permissions."
          >
            {query.data.main.threadId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate.toThread(query.data!.main.threadId!)}
              >
                Open conversation
              </Button>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Home and recovery details
              </summary>
              <p className="mt-2 break-all">
                {query.data.setup.homePath ?? "Home not provisioned yet"}
              </p>
              <p className="mt-1">
                The original home is preserved. Restore it on its recorded
                machine if it is unavailable.
              </p>
            </details>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

export function BotsSettings() {
  const selectorId = useId();
  const visible = usePageVisible(),
    navigate = useBbNavigate();
  const query = useRpcQuery({
    contract: managementContract,
    method: "list",
    input: {},
    enabled: visible,
  });
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!selected && query.data?.bots[0]) setSelected(query.data.bots[0].id);
  }, [selected, query.data]);
  const botId = selected || query.data?.bots[0]?.id;
  return (
    <div className="space-y-6 text-sm text-foreground">
      <SettingsGroup
        title="Bot settings"
        description="Choose a collaborator to edit its configuration. These settings belong to that bot."
      >
        {query.isLoading && <Skeleton className="h-8 w-full" />}
        {query.error && (
          <div role="alert">
            <p className="text-xs text-destructive">
              Could not load bots. Check the connection and try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void query.refetch()}
            >
              Retry bot list
            </Button>
          </div>
        )}
        {query.data?.bots.length === 0 && (
          <div>
            <p className="text-xs text-muted-foreground">
              No bots yet. Create a collaborator from Bots to configure it here.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => navigate.toPluginPanel("bots", { subPath: "new" })}
            >
              Create a bot
            </Button>
          </div>
        )}
        {botId && (
          <SettingRow label="Bot" htmlFor={selectorId}>
            <Select value={botId} onValueChange={setSelected}>
              <SelectTrigger id={selectorId} className={SETTINGS_CONTROL_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selected &&
                  !query.data?.bots.some((bot) => bot.id === selected) && (
                    <SelectItem value={selected}>Current selection</SelectItem>
                  )}
                {query.data?.bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {bot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        {query.data?.hasMore && (
          <p className="text-xs text-muted-foreground">
            Showing the first 100 bots. Open a known bot's Settings from its
            overview for another collaborator.
          </p>
        )}
      </SettingsGroup>
      {botId && <BotSettings key={botId} botId={botId} />}
    </div>
  );
}
