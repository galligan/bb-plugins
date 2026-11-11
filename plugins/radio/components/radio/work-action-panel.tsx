import { useState, type ReactNode } from "react";
import { useActing } from "./acting-context.ts";
import { useWorkRecovery } from "./use-work-recovery.ts";
import { workRecoveryKey, type WorkScope } from "./commitment-result.ts";
import { RadioLink } from "./link.tsx";
import { Button } from "../ui/button.tsx";
export type WorkRecovery = ReturnType<typeof useWorkRecovery>;
export function WorkActionPanel({
  txId,
  commitmentId,
  children,
}: {
  txId: string;
  commitmentId?: string;
  children: (recovery: WorkRecovery) => ReactNode;
}) {
  const acting = useActing();
  if (!acting.identity)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a verified acting identity to record work actions.
      </p>
    );
  const scope = {
    identity: acting.identity,
    projectId: acting.projectId,
    txId,
    commitmentId,
  };
  return (
    <Actions key={workRecoveryKey(scope)} scope={scope}>
      {children}
    </Actions>
  );
}
function Actions({
  scope,
  children,
}: {
  scope: WorkScope;
  children: (recovery: WorkRecovery) => ReactNode;
}) {
  const acting = useActing();
  const recovery = useWorkRecovery(scope);
  const [checked, setChecked] = useState(false);
  const needsRecovery =
    recovery.unreadable || !!(recovery.saved && !recovery.saved.outcome);
  return (
    <div className="space-y-3">
      {recovery.error ? (
        <p role="alert" className="text-sm text-destructive break-words">
          {recovery.error}
        </p>
      ) : null}
      {recovery.saved?.outcome ? (
        <p role="status" className="text-sm">
          Recorded {recovery.saved.request.kind}.{" "}
          <RadioLink
            route={{
              projectId: scope.projectId,
              kind: "commitment",
              id: recovery.saved.outcome.commitment.id,
            }}
          >
            Inspect commitment
          </RadioLink>{" "}
          and{" "}
          <RadioLink
            route={{
              projectId: scope.projectId,
              kind: "transmission",
              id: scope.txId,
            }}
          >
            request history
          </RadioLink>{" "}
          for current work state.
        </p>
      ) : null}
      {children(recovery)}
      {recovery.saved && !recovery.saved.outcome ? (
        <div className="space-y-2 text-sm">
          <p className="break-words">
            Original work action: {recovery.saved.request.kind} ·{" "}
            <code>
              {"targetId" in recovery.saved.request
                ? recovery.saved.request.targetId
                : "commitmentId" in recovery.saved.request
                  ? recovery.saved.request.commitmentId
                  : recovery.saved.request.expectedCommitmentId}
            </code>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={recovery.pending || acting.pending}
            onClick={() => void recovery.send(recovery.saved!.request, true)}
          >
            Retry original work action
          </Button>
        </div>
      ) : null}
      {needsRecovery ? (
        <div className="space-y-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              disabled={recovery.pending || acting.pending}
            />
            I inspected work history and accept that the original action may
            already be recorded.
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!checked || recovery.pending || acting.pending}
            onClick={() => {
              recovery.clear();
              setChecked(false);
            }}
          >
            Clear work recovery
          </Button>
        </div>
      ) : null}
    </div>
  );
}
