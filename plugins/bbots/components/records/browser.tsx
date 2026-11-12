import {
  useId,
  useState,
  useRef,
  useCallback,
  useEffect,
  type FormEvent,
} from "react";
import { experimental_useRpcQuery as useRpcQuery } from "@get-bb/plugin-sdk/app";
import { recordsContract } from "../../lib/ui/records-contracts.ts";
import { kind as memoryKind } from "../../lib/memory/contracts.ts";
import {
  SettingsGroup,
  SettingRow,
  SETTINGS_CONTROL_CLASS,
} from "../settings/layout.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select.tsx";
import { MemoryNote } from "./note.tsx";
import { CheckpointIndex } from "./checkpoints.tsx";
import { CommitmentIndex } from "./commitments.tsx";
import { CheckpointDetail } from "./checkpoint-detail.tsx";

const kinds = [
  ["knowledge", "Knowledge"],
  ["state", "Recent state"],
  ["decision", "Decisions"],
  ["summary", "Summaries"],
] as const;

export function RecordsBrowser({
  threadId,
  botId,
  name,
  active,
}: {
  threadId: string;
  botId: string;
  name: string;
  active: boolean;
}) {
  const searchId = useId(),
    kindId = useId();
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState("");
  const [kind, setKind] = useState<(typeof kinds)[number][0]>("knowledge");
  const [memoryAfter, setMemoryAfter] = useState<string>(),
    [checkpointAfter, setCheckpointAfter] = useState<string>();
  const [selected, setSelected] = useState<{
    kind: "memory" | "checkpoint";
    id: string;
    after?: string;
  } | null>(null);
  const [checkpointDraft, setCheckpointDraft] = useState({
    name: "",
    reason: "",
  });
  const focusDetail = useRef(false),
    focusSearch = useRef(false);
  const focusCheckpoint = useRef<string | null>(null);
  const detailRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && focusDetail.current) {
      focusDetail.current = false;
      node.focus();
    }
  }, []);
  const searchRef = useCallback((node: HTMLInputElement | null) => {
    if (node && focusSearch.current) {
      focusSearch.current = false;
      focusCheckpoint.current = null;
      node.focus();
    }
  }, []);
  useEffect(() => {
    if (!active) {
      focusDetail.current = false;
      focusSearch.current = false;
      focusCheckpoint.current = null;
    }
  }, [active]);
  const query = useRpcQuery({
    contract: recordsContract,
    method: "botRecords",
    input: {
      threadId,
      kind,
      query: search,
      ...(memoryAfter ? { memoryAfter } : {}),
      ...(checkpointAfter ? { checkpointAfter } : {}),
    },
    enabled: active && selected === null,
  });
  const state =
    query.data?.threadId === threadId &&
    query.data.botId === botId &&
    !query.error
      ? query.data
      : undefined;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    setSearch(draft);
    setMemoryAfter(undefined);
  }
  if (!active)
    return (
      <p className="text-xs text-muted-foreground">
        Record reads pause while this tab is hidden.
      </p>
    );
  if (selected?.kind === "checkpoint")
    return (
      <CheckpointDetail
        key={selected.id}
        threadId={threadId}
        botId={botId}
        id={selected.id}
        after={selected.after}
        active={active}
        backRef={detailRef}
        page={(after) => setSelected({ ...selected, after })}
        back={() => {
          focusCheckpoint.current = selected.id;
          setSelected(null);
        }}
      />
    );
  if (selected)
    return (
      <MemoryNote
        key={selected.id}
        threadId={threadId}
        botId={botId}
        id={selected.id}
        active={active}
        backRef={detailRef}
        back={() => {
          focusSearch.current = true;
          setSelected(null);
        }}
      />
    );
  return (
    <div className="min-w-0 space-y-6 text-sm text-foreground">
      <p className="text-xs text-muted-foreground">
        @{name}'s retained records. Inspect memory, commitments and historical
        checkpoint selections. Changes require explicit actions.
      </p>
      <SettingsGroup
        title="Memory"
        description="Knowledge and in-turn captures retain their evidence and uncertainty. These excerpts do not replace authoritative task status."
      >
        <form onSubmit={submit} className="space-y-3">
          <SettingRow label="Record kind" htmlFor={kindId}>
            <Select
              value={kind}
              onValueChange={(value) => {
                const parsed = memoryKind.safeParse(value);
                if (parsed.success) {
                  setKind(parsed.data);
                  setMemoryAfter(undefined);
                }
              }}
            >
              <SelectTrigger id={kindId} className={SETTINGS_CONTROL_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Search memory" htmlFor={searchId}>
            <Input
              ref={searchRef}
              id={searchId}
              type="search"
              value={draft}
              maxLength={256}
              onChange={(event) => setDraft(event.target.value)}
              className={SETTINGS_CONTROL_CLASS}
            />
          </SettingRow>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Refresh records
            </Button>
            <Button type="submit" size="sm" disabled={query.isFetching}>
              Search memory
            </Button>
          </div>
        </form>
        {query.isLoading && <p role="status">Reading bot records…</p>}
        {query.error && (
          <div role="alert">
            <p className="text-xs text-destructive">
              Could not read current records. Check the connection and refresh;
              an empty result is not established.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry records read
            </Button>
          </div>
        )}
        {state?.memory.items.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {search.length
              ? "No records match this search."
              : "No retrievable records of this kind yet."}
          </p>
        )}
        <div className="divide-y divide-border" aria-label="Memory records">
          {state?.memory.items.map((note) => (
            <article key={note.id} className="space-y-2 py-3">
              <h3 className="text-sm font-medium">{note.topic}</h3>
              <p className="text-xs text-muted-foreground">
                Revision {note.revision} ·{" "}
                {note.basis === "fact" ? "Recorded as fact" : "Inference"} ·{" "}
                {note.sourceCount} evidence sources
              </p>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {note.excerpt}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  focusDetail.current = true;
                  setSelected({ kind: "memory", id: note.id });
                }}
                aria-label={`Read full memory ${note.topic}`}
              >
                Read full memory
              </Button>
            </article>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {memoryAfter && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => setMemoryAfter(undefined)}
            >
              First memories
            </Button>
          )}
          {state?.memory.nextCursor && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => setMemoryAfter(state.memory.nextCursor!)}
            >
              More memories
            </Button>
          )}
        </div>
      </SettingsGroup>
      <CommitmentIndex threadId={threadId} botId={botId} active={active} />
      <CheckpointIndex
        inspect={(id) => {
          focusDetail.current = true;
          setSelected({ kind: "checkpoint", id });
        }}
        inspectRef={(id, node) => {
          if (node && !node.disabled && focusCheckpoint.current === id) {
            focusCheckpoint.current = null;
            if (document.activeElement !== document.body) return;
            const disclosure = node.closest("details");
            if (disclosure) disclosure.open = true;
            node.focus();
          }
        }}
        threadId={threadId}
        botId={botId}
        active={active && Boolean(state)}
        draft={checkpointDraft}
        onDraftChange={setCheckpointDraft}
        page={state?.checkpoints}
        pending={query.isFetching}
        hasPrevious={Boolean(checkpointAfter)}
        first={() => setCheckpointAfter(undefined)}
        more={(cursor) => setCheckpointAfter(cursor)}
      />
    </div>
  );
}
