import { useId, useState } from "react";
import type { ResponseKind } from "../../lib/protocol-contracts.ts";
import { useActing } from "./acting-context.ts";
import {
  responseRecoveryKey,
  useResponseRecovery,
  type ResponseScope,
} from "./use-response-recovery.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";

export function RecipientResponseControls({
  txId,
  recipientIds,
}: {
  txId: string;
  recipientIds: string[];
}) {
  const acting = useActing();
  if (!acting.identity) return null;
  const scope = {
    identity: acting.identity,
    projectId: acting.projectId,
    txId,
  };
  return (
    <ResponseControls
      key={responseRecoveryKey(scope)}
      scope={scope}
      recipientIds={recipientIds}
    />
  );
}
function ResponseControls({
  scope,
  recipientIds,
}: {
  scope: ResponseScope;
  recipientIds: string[];
}) {
  const acting = useActing();
  const recovery = useResponseRecovery(scope);
  const id = useId();
  const targets = [scope.identity.actorId, scope.identity.sessionId].filter(
    (target): target is string => !!target && recipientIds.includes(target),
  );
  const [targetId, setTarget] = useState(
    recovery.saved?.request.targetId ??
      (targets.length === 1 ? targets[0]! : ""),
  );
  const [reason, setReason] = useState(
    recovery.saved?.request.kind === "standby"
      ? (recovery.saved.request.reason ?? "")
      : "",
  );
  const [received, setReceived] = useState(false);
  const [checkedHistory, setCheckedHistory] = useState(false);
  const canReceive =
    acting.mode === "operator" && scope.identity.sessionId === null;
  function record(kind: ResponseKind) {
    if (
      !targets.includes(targetId) ||
      recovery.blocked ||
      (kind === "received" && (!canReceive || !received))
    )
      return;
    void recovery.send({
      txId: scope.txId,
      targetId,
      kind,
      idempotencyKey: crypto.randomUUID(),
      ...(kind === "standby" && reason.trim() ? { reason: reason.trim() } : {}),
    });
  }
  const needsRecovery =
    recovery.unreadable || !!(recovery.saved && !recovery.saved.event);
  return (
    <section
      aria-label="Record a recipient response"
      className="space-y-3 border-t border-border pt-4"
    >
      <h3 className="font-medium">Record a recipient response</h3>
      <p className="text-xs text-muted-foreground">
        Each action records one addressed canonical recipient. Ack, receipt and
        commitments stay separate. Standby means waiting with no work
        commitment; squelch does not waive obligations.
      </p>
      {recovery.error ? (
        <p role="alert" className="text-sm text-destructive break-words">
          {recovery.error}
        </p>
      ) : null}
      {recovery.saved?.event ? (
        <p role="status" className="text-sm">
          Recorded {recovery.saved.event.kind} for{" "}
          <code>{recovery.saved.event.targetId}</code>. No other recipient is
          covered.
        </p>
      ) : null}
      {!targets.length ? (
        <p className="text-sm text-muted-foreground">
          This acting identity has no addressed recipient on this transmission.
        </p>
      ) : (
        <fieldset disabled={recovery.blocked} className="space-y-3 min-w-0">
          <div className="space-y-1">
            <label htmlFor={`${id}-target`} className="text-sm">
              Response recipient
            </label>
            <Select
              value={targetId || undefined}
              disabled={recovery.blocked}
              onValueChange={setTarget}
            >
              <SelectTrigger id={`${id}-target`} className="w-full">
                <SelectValue placeholder="Choose one recipient" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target} value={target}>
                    {target === scope.identity.actorId
                      ? canReceive
                        ? "Human"
                        : "Actor"
                      : "Acting session"}{" "}
                    · {target}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-reason`} className="text-sm">
              Standby reason (optional)
            </label>
            <Input
              id={`${id}-reason`}
              value={reason}
              maxLength={400}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={recovery.blocked || !targets.includes(targetId)}
              onClick={() => record("ack")}
            >
              Record ack
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={recovery.blocked || !targets.includes(targetId)}
              onClick={() => record("standby")}
            >
              Record standby
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={recovery.blocked || !targets.includes(targetId)}
              onClick={() => record("squelch")}
            >
              Record squelch
            </Button>
          </div>
          {canReceive ? (
            <div className="space-y-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={received}
                  onChange={(event) => setReceived(event.target.checked)}
                />
                I received this content as @user
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  recovery.blocked || !received || !targets.includes(targetId)
                }
                onClick={() => record("received")}
              >
                Confirm my receipt
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Viewing this panel does not establish receipt by a BB session.
              That session must explicitly confirm through its own tool or CLI
              after receiving the content.
            </p>
          )}
        </fieldset>
      )}
      {recovery.saved && !recovery.saved.event ? (
        <div className="space-y-2 text-sm">
          <p className="break-words">
            Original response: {recovery.saved.request.kind} for{" "}
            <code>{recovery.saved.request.targetId}</code>
            {recovery.saved.request.kind === "standby" &&
            recovery.saved.request.reason
              ? ` · ${recovery.saved.request.reason}`
              : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={recovery.pending || acting.pending}
            onClick={() => void recovery.send(recovery.saved!.request, true)}
          >
            Retry original response
          </Button>
        </div>
      ) : null}
      {needsRecovery ? (
        <div className="space-y-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checkedHistory}
              onChange={(event) => setCheckedHistory(event.target.checked)}
              disabled={recovery.pending || acting.pending}
            />
            I inspected response history and accept that the original response
            may already be recorded.
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!checkedHistory || recovery.pending || acting.pending}
            onClick={() => {
              recovery.clear();
              setCheckedHistory(false);
            }}
          >
            Clear response recovery
          </Button>
        </div>
      ) : null}
    </section>
  );
}
