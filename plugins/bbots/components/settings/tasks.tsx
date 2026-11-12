import { useEffect, useId, useState, type FormEvent } from "react";
import {
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { Board } from "../../lib/tasks/client.ts";
import {
  taskSettingsContract,
  type TaskSettingsState,
} from "../../lib/tasks/settings-contracts.ts";
import { usePageVisible } from "../../lib/ui/use-page-visible.ts";
import {
  SettingsGroup,
  SettingRow,
  SETTINGS_CONTROL_CLASS,
} from "./layout.tsx";
import { TaskSourceSummary } from "../task-source.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select.tsx";

export function TaskSettings({ botId }: { botId: string }) {
  const visible = usePageVisible(),
    searchId = useId(),
    boardId = useId();
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Board | null>(null);
  const [confirmed, setConfirmed] = useState<TaskSettingsState | null>(null),
    [saved, setSaved] = useState(false);
  const [lastRead, setLastRead] = useState<TaskSettingsState | null>(null);
  const query = useRpcQuery({
    contract: taskSettingsContract,
    method: "taskSettings",
    input: { botId, query: search },
    enabled: visible,
  });
  const mutation = useRpcMutation({
    contract: taskSettingsContract,
    method: "taskBoardSelect",
  });
  const fetched = query.data?.botId === botId ? query.data : undefined;
  // A new filter has a new RPC query key. Retain this form's last read so
  // background loading cannot unmount its controls and steal input focus.
  useEffect(() => {
    if (fetched) setLastRead(fetched);
  }, [fetched]);
  const state =
    confirmed?.botId === botId &&
    (!fetched || confirmed.revision > fetched.revision)
      ? confirmed
      : (fetched ?? (lastRead?.botId === botId ? lastRead : undefined));
  const choices = state?.catalog.boards ?? [];
  const choosing =
    state?.kind === "unconfigured" && state.availability === "unconfigured";
  const canSave =
    choosing &&
    state.catalog.status === "available" &&
    Boolean(selected) &&
    visible &&
    !query.error &&
    !mutation.error &&
    !mutation.isPending;
  function readSaved() {
    if (!visible || mutation.isPending) return;
    void query
      .refetch()
      .then(() => mutation.reset())
      .catch(() => {});
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !state || !selected) return;
    try {
      const result = await mutation.mutate({
        botId,
        boardId: selected.id,
        expectedRevision: state.revision,
      });
      setConfirmed(result);
      setSaved(true);
      void query.refetch().catch(() => {});
    } catch {
      setSaved(false);
    }
  }
  return (
    <SettingsGroup
      title="Task source"
      description="Choose where this collaborator keeps its tasks. An established source remains authoritative until a deliberate migration."
    >
      <TaskSourceSummary
        botId={botId}
        source={
          state
            ? {
                kind: state.kind,
                availability: state.availability,
                boardId: state.board?.id ?? null,
                file: state.file,
              }
            : undefined
        }
        boardName={state?.board?.name}
        loading={query.isLoading && !state}
        readError={Boolean(query.error)}
        visible={visible}
        retry={readSaved}
        configure={false}
      />
      {choosing && (
        <form onSubmit={(event) => void save(event)} className="space-y-3">
          <SettingRow label="Find board" htmlFor={searchId}>
            <Input
              id={searchId}
              type="search"
              className={SETTINGS_CONTROL_CLASS}
              value={search}
              maxLength={128}
              placeholder="Board name or prefix"
              disabled={mutation.isPending || !visible}
              onChange={(event) => setSearch(event.target.value)}
            />
          </SettingRow>
          <SettingRow label="Board" htmlFor={boardId}>
            <Select
              value={selected?.id ?? ""}
              onValueChange={(id) =>
                setSelected(
                  choices.find((board) => board.id === id) ?? selected,
                )
              }
              disabled={
                mutation.isPending ||
                !visible ||
                state.catalog.status !== "available"
              }
            >
              <SelectTrigger id={boardId} className={SETTINGS_CONTROL_CLASS}>
                <SelectValue placeholder="Choose a board" />
              </SelectTrigger>
              <SelectContent>
                {selected &&
                  !choices.some((board) => board.id === selected.id) && (
                    <SelectItem value={selected.id}>
                      {selected.name} · {selected.prefix}
                    </SelectItem>
                  )}
                {choices.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name} · {board.prefix}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          {state.catalog.status === "unavailable" && (
            <p role="alert" className="text-xs text-destructive">
              Could not load Tasks boards. Restore Tasks and read the source
              again; no task file or replacement board was created.
            </p>
          )}
          {state.catalog.status === "available" && choices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {search.trim()
                ? "No boards match this search."
                : "No Tasks boards yet. Create a board in Tasks, then refresh this list."}
            </p>
          )}
          {state.catalog.hasMore && (
            <p className="text-xs text-muted-foreground">
              More boards match. Refine the search to find yours.
            </p>
          )}
          {mutation.error && (
            <p role="alert" className="text-xs text-destructive">
              Could not confirm the task source save. Your choice is kept. Read
              the saved source before trying again.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={mutation.isPending || !visible}
              onClick={readSaved}
            >
              {mutation.error ? "Read saved task source" : "Refresh boards"}
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {mutation.isPending ? "Saving…" : "Use selected board"}
            </Button>
          </div>
        </form>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Task source saved.
        </p>
      )}
      {state && state.kind !== "unconfigured" && (
        <p className="text-xs text-muted-foreground">
          Changing an established source requires an inspected migration. Ask
          your bot to prepare that change; this page does not replace it
          automatically.
        </p>
      )}
    </SettingsGroup>
  );
}
