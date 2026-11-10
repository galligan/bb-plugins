import { useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import {
  removalConsequences,
  rowState,
  type OverviewRow,
} from "../lib/overview.ts";
import { age } from "../lib/render.ts";
import { branchDescription } from "../lib/display.ts";

export function WorktreeRow({
  row,
  remove,
}: {
  row: OverviewRow;
  remove: () => Promise<void>;
}) {
  const navigate = useBbNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inspection = row.status === "present" ? row.inspection : null;
  const path = row.status === "present" ? row.inspection.path : row.path;
  const state = rowState(row, Date.now());
  const consequences =
    inspection === null ? null : removalConsequences(inspection);
  const [refused, setRefused] = useState(false);
  const retry = refused || row.environment?.teardown?.status === "failed";
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await remove();
      dialog.current?.close();
    } catch (error) {
      setRefused(true);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="rounded border border-border p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong>
          {inspection?.branch ??
            (inspection === null ? row.pathKey : "(detached)")}
        </strong>
        <span className="rounded bg-state-hover px-2 text-xs">
          {state.kind === "attention"
            ? "Needs attention"
            : state.kind === "retiring"
              ? "Retiring"
              : state.kind === "orphaned"
                ? "Orphaned"
                : "In use"}
        </span>
        <span>
          {inspection === null
            ? "UNKNOWN"
            : inspection.safeToRemove
              ? "SAFE"
              : "UNSAVED"}
        </span>
      </div>
      <p className="break-all font-mono text-xs text-subtle-foreground">
        {path}
      </p>
      {state.badge && <p>{state.badge}</p>}
      {inspection && (
        <>
          <p className="text-sm">
            {branchDescription(inspection)} · last activity{" "}
            {age(inspection.lastActivity, Date.now())}
          </p>
          {inspection.reasons.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {inspection.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {row.threads.map((thread) => (
          <button
            key={thread.id}
            className="underline"
            onClick={() => navigate.toThread(thread.id)}
            aria-label={`Open thread: ${thread.title}`}
          >
            {thread.title}
            {thread.archived ? " (archived)" : ""}
          </button>
        ))}
        <button
          className="underline"
          disabled={busy}
          onClick={() => {
            setError(null);
            dialog.current?.showModal();
          }}
        >
          {retry ? "Retry removal" : "Remove"}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="max-w-lg rounded border border-border bg-background p-6 text-foreground shadow-lg"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        aria-label="Confirm worktree removal"
      >
        <h3 className="font-semibold">
          {retry ? "Retry removal?" : "Remove worktree?"}
        </h3>
        <p className="my-3 break-all font-mono text-xs">{path}</p>
        <p>
          The branch is kept. Cleanup runs before a fresh safety inspection. If
          anything blocks removal, the folder is kept.
        </p>
        {consequences && (
          <ul className="my-3 list-disc pl-5">
            {[...consequences.saved, ...consequences.blocked].map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {consequences !== null && consequences.blocked.length > 0 && (
          <p>
            No rescue or deletion takes place while a blocking condition
            remains.
          </p>
        )}
        {inspection === null && (
          <p>
            The host will verify the record and ownership before touching the
            folder.
          </p>
        )}
        {error && (
          <p role="alert" className="my-3">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-4">
          <button disabled={busy} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button disabled={busy} onClick={() => void confirm()}>
            {busy ? "Requesting…" : retry ? "Retry removal" : "Remove"}
          </button>
        </div>
      </dialog>
    </li>
  );
}
