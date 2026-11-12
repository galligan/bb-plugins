import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { experimental_useRpcMutation as useRpcMutation } from "@get-bb/plugin-sdk/app";
import {
  checkpointRequest,
  checkpointUiContract,
} from "../../lib/ui/checkpoint-contracts.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { SettingRow, SETTINGS_CONTROL_CLASS } from "../settings/layout.tsx";
import {
  readCheckpointRequest,
  retainCheckpointRequest,
  clearCheckpointRequest,
  checkpointRequestEvent,
  type CheckpointRequest,
} from "./checkpoint-request.ts";

function initial(botId: string) {
  try {
    return { request: readCheckpointRequest(botId), error: false };
  } catch {
    return { request: null, error: true };
  }
}

export function CheckpointCreate({
  threadId,
  botId,
  active,
  draft,
  onDraftChange,
}: {
  threadId: string;
  botId: string;
  active: boolean;
  draft: { name: string; reason: string };
  onDraftChange(value: { name: string; reason: string }): void;
}) {
  const [retained] = useState(() => initial(botId));
  const [pending, setPending] = useState(retained.request);
  const { name, reason } = draft;
  const [storageError, setStorageError] = useState(retained.error);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const nameId = useId(),
    reasonId = useId();
  const mutation = useRpcMutation({
    contract: checkpointUiContract,
    method: "botCheckpointCreate",
  });
  useEffect(() => {
    // A request can finish while this view is hidden/remounted, or another
    // split can retain it. Observe intent only; never replay on these events.
    const reconcile = () => {
      const current = initial(botId);
      setPending(current.request);
      setStorageError(current.error);
    };
    window.addEventListener(checkpointRequestEvent, reconcile);
    window.addEventListener("storage", reconcile);
    return () => {
      window.removeEventListener(checkpointRequestEvent, reconcile);
      window.removeEventListener("storage", reconcile);
    };
  }, [botId]);

  async function send(value: CheckpointRequest) {
    setSaved(false);
    try {
      const result = await mutation.mutate(value);
      if (
        result.checkpoint.botId !== botId ||
        result.checkpoint.id !== `chk_${value.requestId}` ||
        result.checkpoint.name !== value.name ||
        result.checkpoint.reason !== value.reason
      )
        throw new Error(
          "The checkpoint response differs from the retained request.",
        );
      clearCheckpointRequest(value);
      setPending(null);
      onDraftChange({ name: "", reason: "" });
      setSaved(true);
    } catch {
      // A rejected response is not evidence that the SQLite write did not occur.
      // Only the same retained request can be deliberately recovered.
    } finally {
      busy.current = false;
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    if (!active || busy.current || pending || storageError) return;
    const value = checkpointRequest.safeParse({
      threadId,
      expectedBotId: botId,
      requestId: crypto.randomUUID(),
      name,
      reason,
    });
    if (!value.success) return;
    busy.current = true;
    try {
      retainCheckpointRequest(value.data);
    } catch {
      const existing = initial(botId);
      setPending(existing.request);
      setStorageError(existing.error || !existing.request);
      busy.current = false;
      return;
    }
    setPending(value.data);
    void send(value.data);
  }
  function recover() {
    if (!active || busy.current || !pending || storageError) return;
    try {
      const current = readCheckpointRequest(botId);
      if (JSON.stringify(current) !== JSON.stringify(pending))
        throw new Error("Retained request changed");
    } catch {
      setStorageError(true);
      return;
    }
    busy.current = true;
    void send(pending);
  }
  return (
    <form onSubmit={create} className="space-y-3 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        Save a named selection of current identity, SOUL, future execution
        defaults and eligible knowledge. This starts no turn or restore and is
        not a complete database backup.
      </p>
      <SettingRow label="Checkpoint name" htmlFor={nameId}>
        <Input
          id={nameId}
          className={SETTINGS_CONTROL_CLASS}
          value={pending?.name ?? name}
          maxLength={128}
          required
          disabled={
            !active || Boolean(pending) || mutation.isPending || storageError
          }
          onChange={(event) => {
            onDraftChange({ ...draft, name: event.target.value });
            setSaved(false);
          }}
        />
      </SettingRow>
      <SettingRow label="Checkpoint reason" htmlFor={reasonId}>
        <Textarea
          id={reasonId}
          value={pending?.reason ?? reason}
          maxLength={2048}
          required
          rows={2}
          disabled={
            !active || Boolean(pending) || mutation.isPending || storageError
          }
          onChange={(event) => {
            onDraftChange({ ...draft, reason: event.target.value });
            setSaved(false);
          }}
        />
      </SettingRow>
      {storageError && (
        <p role="alert" className="text-xs text-destructive">
          Could not safely retain or verify this checkpoint request. No new
          request is sent. Preserve the browser's session data and inspect the
          existing checkpoint records before recovery.
        </p>
      )}
      {pending && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p role="status">
            {mutation.isPending
              ? "Saving checkpoint…"
              : "Checkpoint delivery is unconfirmed. Recovery reuses the original request and saved selection if it already exists; no automatic retry is sent."}
          </p>
          <details>
            <summary className="cursor-pointer">
              Checkpoint request reference
            </summary>
            <code className="break-all">{pending.requestId}</code>
          </details>
        </div>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Checkpoint saved. Refresh records to see its header.
        </p>
      )}
      <div className="flex justify-end">
        {pending ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!active || mutation.isPending || storageError}
            onClick={recover}
          >
            Recover checkpoint
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            disabled={
              !active ||
              mutation.isPending ||
              storageError ||
              !name.trim() ||
              !reason.trim()
            }
          >
            Create checkpoint
          </Button>
        )}
      </div>
    </form>
  );
}
