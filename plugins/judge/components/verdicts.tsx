import { useCallback } from "react";
import {
  experimental_DetailRow as DetailRow,
  useSettings,
  type ExperimentalThreadInfoProps,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";
import {
  displayRowsSchema,
  threadDisplaySchema,
  type DisplayRow,
} from "../lib/ui-contract.ts";
import { useJudgeRpc, useRead } from "./hooks.ts";
function Labels({ row }: { row: DisplayRow }) {
  return (
    <>
      {row.badges.map((badge, index) => (
        <span
          className="judge-badge"
          key={`${badge.setId}-${index}`}
          title={badge.setId}
        >
          {badge.label}
        </span>
      ))}
      {row.extraBadges > 0 && <span>+{row.extraBadges}</span>}
    </>
  );
}
export function VerdictInfo({ threadId }: ExperimentalThreadInfoProps) {
  const rpc = useJudgeRpc();
  const load = useCallback(
    async () =>
      threadDisplaySchema.parse(await rpc.call("ui.thread", { threadId })),
    [rpc, threadId],
  );
  const read = useRead(threadId, load, [threadId]);
  return (
    <DetailRow label="Judge" icon="Scale" align="start">
      <div className="judge-ui judge-verdict">
        {read.error ? (
          <p role="alert">{read.error}</p>
        ) : !read.data ? (
          <span role="status">Loading Judge…</span>
        ) : (
          <>
            <Labels row={read.data.current} />
            {read.data.current.badges.length === 0 && <p>No current badges.</p>}
            {read.data.latest ? (
              <>
                <p>
                  Latest run:{" "}
                  <strong>
                    {read.data.latest.status === "recorded"
                      ? "Recorded (not current)"
                      : read.data.latest.status}
                  </strong>
                  {read.data.latest.setId
                    ? ` · ${read.data.latest.setId}`
                    : " · ad hoc"}
                </p>
                <time
                  dateTime={new Date(read.data.latest.startedAt).toISOString()}
                >
                  {new Date(read.data.latest.startedAt).toLocaleString()}
                </time>
                {read.data.latest.models.map((model, i) => (
                  <p key={i}>
                    {model.id}: {model.model}
                    {model.providerModel ? ` → ${model.providerModel}` : ""}
                  </p>
                ))}
                {read.data.latest.code && (
                  <p>Unavailable: {read.data.latest.code}</p>
                )}
              </>
            ) : (
              <p>No recorded runs for this thread.</p>
            )}
            {read.data.current.publicationFailure && (
              <p role="status">
                Badge display: {read.data.current.publicationFailure}
              </p>
            )}
          </>
        )}
        <button type="button" onClick={read.refresh}>
          Refresh Judge
        </button>
        <small>Model judgments are evidence, not authorization.</small>
      </div>
    </DetailRow>
  );
}
export function useVerdictRows({
  threads,
}: ExperimentalThreadRowMetadataDataInput) {
  const rpc = useJudgeRpc();
  const settings = useSettings();
  const enabled =
    !settings.isLoading && settings.values?.showSidebarBadges === true;
  const keys = JSON.stringify([...new Set(threads.map((t) => t.id))].sort());
  const load = useCallback(
    async (signal: AbortSignal) => {
      const rows: Record<string, DisplayRow> = Object.create(null);
      if (!enabled) return rows;
      const ids: string[] = JSON.parse(keys);
      // Sequential bounded requests; no per-row SDK reads or unbounded fan-out.
      for (let offset = 0; offset < ids.length; offset += 200) {
        if (signal.aborted) return rows;
        const requested = ids.slice(offset, offset + 200);
        const result = displayRowsSchema.parse(
          await rpc.call("ui.badges", { threadIds: requested }),
        );
        if (
          new Set(result.threads.map((r) => r.threadId)).size !==
            result.threads.length ||
          result.threads.some((r) => !requested.includes(r.threadId))
        )
          throw new Error("invalid_metadata");
        for (const row of result.threads) rows[row.threadId] = row;
      }
      return rows;
    },
    [rpc, keys, enabled],
  );
  const read = useRead(
    `${enabled}:${keys}`,
    load,
    enabled ? (JSON.parse(keys) as string[]) : [],
  );
  return enabled && !read.error ? read.data : undefined;
}
export function VerdictBadge({
  thread,
  data,
}: ExperimentalThreadRowMetadataProps<ReturnType<typeof useVerdictRows>>) {
  const row = data?.[thread.id];
  return row?.badges.length ? (
    <span
      className="judge-ui"
      aria-label={`Judge: ${row.badges.map((b) => b.label).join(", ")}`}
    >
      <Labels row={row} />
    </span>
  ) : null;
}
