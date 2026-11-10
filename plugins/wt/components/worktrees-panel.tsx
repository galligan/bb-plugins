import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { restoreCommand } from "../lib/rescue-schema.ts";
import { sortRows } from "../lib/overview.ts";
import { WorktreeRow } from "./worktree-row.tsx";

type Overview = z.infer<typeof rpcContract.overview.output>;
type Rescues = z.infer<typeof rpcContract.rescues.output>;
export function WorktreesPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Overview | null>(null);
  const [rescues, setRescues] = useState<Rescues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const [overview, rescues] = await Promise.all([
        rpc.call("overview", {}),
        rpc.call("rescues", {}),
      ]);
      if (request === sequence.current) {
        setData(overview);
        setRescues(rescues);
        setError(null);
      }
    } catch (error) {
      if (request === sequence.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [rpc]);
  useEffect(() => {
    void refresh();
    const whenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(whenVisible, 30000);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      sequence.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh]);
  useRealtime("worktrees-changed", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  const hasRows =
    data?.machines.some((machine) => machine.worktrees.length > 0) ?? false;
  const multipleMachines =
    (data?.machines.filter((machine) => machine.worktrees.length > 0).length ??
      0) > 1;
  const ids = new Set(
    data?.machines.flatMap((machine) =>
      machine.worktrees.map(
        (row) => row.environment?.projectId ?? row.projectId ?? "unknown",
      ),
    ) ?? [],
  );
  for (const rescue of rescues?.projects ?? [])
    if (rescue.refs.length > 0 || rescue.error !== null)
      ids.add(rescue.projectId);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 text-foreground">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Worktrees</h1>
        <button
          className="rounded border border-border px-3 py-1"
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </button>
      </header>
      {loading && data === null && <p role="status">Loading worktrees…</p>}
      {error && <p role="alert">{error}</p>}
      {data?.machines
        .filter((machine) => machine.error !== null)
        .map((machine) => (
          <p role="alert" key={machine.hostId}>
            {machine.name}: {machine.error}
          </p>
        ))}
      {data && !hasRows && <p>No Worktree+ worktrees.</p>}
      {[...ids].map((projectId) => (
        <section className="space-y-3" key={projectId}>
          <h2 className="text-lg font-semibold">
            {data?.projects.find((project) => project.id === projectId)?.name ??
              "Unknown project"}
          </h2>
          {data?.machines.map((machine) => {
            const rows = sortRows(
              machine.worktrees.filter(
                (row) =>
                  (row.environment?.projectId ?? row.projectId ?? "unknown") ===
                  projectId,
              ),
              Date.now(),
            );
            if (rows.length === 0) return null;
            return (
              <div key={machine.hostId} className="space-y-2">
                {multipleMachines && <h3>{machine.name}</h3>}
                <ul className="space-y-3">
                  {rows.map((row) => (
                    <WorktreeRow
                      key={row.pathKey}
                      row={row}
                      remove={async () => {
                        try {
                          const result = await rpc.call("removeWorktree", {
                            hostId: machine.hostId,
                            pathKey: row.pathKey,
                          });
                          if (result.status === "failed")
                            throw new Error(result.message);
                        } finally {
                          await refresh();
                        }
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
          {rescues?.projects
            .filter(
              (rescue) =>
                rescue.projectId === projectId &&
                (rescue.refs.length > 0 || rescue.error !== null),
            )
            .map((rescue) => (
              <section key={rescue.hostId} className="space-y-2">
                <h3 className="font-semibold">
                  Rescued work ·{" "}
                  {data?.machines.find(
                    (machine) => machine.hostId === rescue.hostId,
                  )?.name ?? rescue.hostId}
                </h3>
                {rescue.error && <p role="alert">{rescue.error}</p>}
                <ul>
                  {rescue.refs.map((ref) => (
                    <li key={ref.ref} className="my-2 space-y-1">
                      <p>
                        {ref.subject} · {ageLabel(ref.createdAt)}
                      </p>
                      <p className="break-all font-mono text-xs">
                        {ref.ref} · {ref.commit}
                      </p>
                      <label className="block text-sm">
                        Restore in the source checkout
                        <input
                          aria-label={`Restore command for ${ref.ref}`}
                          className="block w-full rounded border border-border bg-background p-2 font-mono text-xs"
                          readOnly
                          value={restoreCommand(ref.ref)}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </section>
      ))}
    </main>
  );
}
function ageLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}
