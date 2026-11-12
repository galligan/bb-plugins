import { useState } from "react";
import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { SettingsGroup } from "./settings/layout.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { EmptyStatePanel } from "./ui/empty-state.tsx";
import { Button } from "./ui/button.tsx";
import type { Machine } from "./bots-panel.tsx";
import { TaskSource } from "./task-source.tsx";
import { WorkerOverview } from "./workers/overview.tsx";

export function BotDetail({
  botId,
  machines,
  hostsUnavailable,
}: {
  botId: string;
  machines: Machine[];
  hostsUnavailable: boolean;
}) {
  const navigate = useBbNavigate();
  const query = useRpcQuery({
    contract: managementContract,
    method: "show",
    input: { botId },
  });
  const resume = useRpcMutation({
    contract: managementContract,
    method: "resume",
  });
  const [reconciled, setReconciled] = useState<{
    source: typeof query.data;
    error: string | null;
  } | null>(null);
  const view = query.data;
  const online =
    !hostsUnavailable &&
    machines.some(
      (m) => m.id === view?.setup.request.hostId && m.status === "connected",
    );
  const error =
    reconciled && reconciled.source === view
      ? reconciled.error
      : view?.setup.error;
  return (
    <section className="min-w-0 space-y-6 break-words" aria-label="Bot details">
      {query.isLoading && (
        <div role="status" aria-label="Loading collaborator">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {query.error && (
        <EmptyStatePanel>
          <p role="alert" className="text-xs text-destructive">
            Could not load this bot. Check the connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            Retry bot read
          </Button>
        </EmptyStatePanel>
      )}
      {view && (
        <>
          <SettingsGroup
            title="Conversation"
            description="Continue with the same collaborator in its native BB conversation."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {view.setup.phase === "ready" && !error
                  ? "Main conversation created"
                  : "Setup needs attention"}
              </p>
              {view.main.threadId && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => navigate.toThread(view.main.threadId!)}
                >
                  Open conversation
                </Button>
              )}
            </div>
          </SettingsGroup>
          <SettingsGroup title="Task source">
            <TaskSource botId={view.bot.id} />
          </SettingsGroup>
          <WorkerOverview key={view.bot.id} botId={view.bot.id} />
          <details
            className="text-xs text-muted-foreground"
            open={Boolean(error) || view.setup.phase !== "ready" || !online}
          >
            <summary className="cursor-pointer">
              Setup status and recovery
            </summary>
            <div className="mt-3 space-y-3">
              {hostsUnavailable ? (
                <p role="status">
                  Machine availability is unknown. Refresh before resuming
                  setup.
                </p>
              ) : (
                !online && (
                  <p role="status">
                    The recorded machine is offline or unavailable. Reconnect
                    it; the original home will be preserved.
                  </p>
                )
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <p className="leading-5">
                Checking setup reconciles partial creation and can finish its
                initial acknowledgement. It never replays an uncertain prompt.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resume.isPending || !online}
                onClick={() => {
                  void resume
                    .mutate({ botId })
                    .then((value) => {
                      setReconciled({ source: view, error: value.setup.error });
                      void query.refetch();
                    })
                    .catch(() => {});
                }}
              >
                {resume.isPending ? "Checking setup…" : "Check setup"}
              </Button>
              {resume.error && (
                <p role="alert" className="text-destructive">
                  Could not confirm setup. Check the recorded state before
                  trying again; no duplicate prompt is sent by resume.
                </p>
              )}
              <p className="break-all">
                Home: {view.setup.homePath ?? "Not provisioned yet"}
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
