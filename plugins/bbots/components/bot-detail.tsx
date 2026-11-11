import { useState } from "react";
import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import { managementContract } from "../lib/setup/contracts.ts";
import { soulContract } from "../lib/soul/contracts.ts";
import { Button } from "./ui/button.tsx";
import type { Machine } from "./bots-panel.tsx";

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
  const soul = useRpcQuery({
    contract: soulContract,
    method: "soulShow",
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
    <section className="min-w-0 space-y-3 break-words" aria-label="Bot details">
      {query.isLoading && <p role="status">Loading collaborator…</p>}
      {query.error && (
        <div role="alert">
          <p>Could not load this bot. Check the connection and try again.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Retry bot read
          </Button>
        </div>
      )}
      {view && (
        <>
          <h2 className="font-semibold">{view.bot.name}</h2>
          <p>
            {view.setup.phase === "ready" && !error
              ? "Main conversation created"
              : "Setup needs attention"}
          </p>
          {hostsUnavailable ? (
            <p role="status">
              Machine availability is unknown. Refresh before resuming setup.
            </p>
          ) : (
            !online && (
              <p role="status">
                The recorded machine is offline or unavailable. Reconnect it;
                the original home will be preserved.
              </p>
            )
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {view.main.threadId && (
            <Button
              type="button"
              onClick={() => navigate.toThread(view.main.threadId!)}
            >
              Open ongoing conversation
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
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
            {resume.isPending ? "Checking setup…" : "Check / resume setup"}
          </Button>
          {resume.error && (
            <p role="alert" className="text-destructive">
              Could not confirm setup. Check the recorded state before trying
              again; no duplicate prompt is sent by resume.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Opening uses the native conversation. Check / resume reconciles
            partial setup and can finish its initial acknowledgement; it never
            replays an uncertain prompt.
          </p>
          <p className="text-sm">
            Home: {view.setup.homePath ?? "Not provisioned yet"}
          </p>
          {soul.data && (
            <p className="text-sm text-muted-foreground">
              SOUL revision {soul.data.current?.revision ?? "unavailable"}; last
              supplied {soul.data.lastSuppliedRevision ?? "none"}. Applied
              revision unknown; existing sessions may retain older guidance.
            </p>
          )}
          {soul.error && (
            <p role="alert">Could not read soul revision status.</p>
          )}
        </>
      )}
    </section>
  );
}
