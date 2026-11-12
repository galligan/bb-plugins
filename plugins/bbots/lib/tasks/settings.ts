import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TaskSource } from "./source.ts";
import { tasksClient } from "./client.ts";
import {
  taskSettingsContract,
  taskSettingsState,
  type TaskSettingsState,
} from "./settings-contracts.ts";

export function createTaskSettings(
  bb: BbPluginApi,
  source: TaskSource,
  lifecycle: AbortSignal,
) {
  const client = tasksClient(bb, lifecycle);
  function check(signal?: AbortSignal) {
    lifecycle.throwIfAborted();
    signal?.throwIfAborted();
  }
  async function read(
    input: { botId: string; query?: string },
    signal?: AbortSignal,
  ) {
    const value = taskSettingsContract.taskSettings.input.parse(input);
    check(signal);
    const state = await source.show(value.botId, signal);
    check(signal);
    let catalog: TaskSettingsState["catalog"] = {
      status: "not-applicable",
      boards: [],
      hasMore: false,
    };
    if (!state.source) {
      try {
        const boards = await client.list(signal);
        check(signal);
        const query = value.query.trim().toLowerCase();
        const matches = boards.filter((board) =>
          `${board.name} ${board.prefix}`.toLowerCase().includes(query),
        );
        catalog = {
          status: "available",
          boards: matches.slice(0, 100),
          hasMore: matches.length > 100,
        };
      } catch {
        check(signal);
        catalog = { status: "unavailable", boards: [], hasMore: false };
      }
    }
    const latest = source.read(value.botId),
      changed = latest.revision !== state.revision;
    const authority = changed ? latest.source : state.source;
    const observedBoard = !changed && "board" in state ? state.board : null;
    return taskSettingsState.parse({
      botId: value.botId,
      revision: latest.revision,
      kind: authority?.kind ?? "unconfigured",
      availability: changed ? "changed-during-read" : state.availability,
      board:
        authority?.kind === "tasks" && authority.phase === "ready"
          ? {
              id: authority.boardId,
              name: observedBoard?.name ?? null,
              prefix: observedBoard?.prefix ?? null,
            }
          : null,
      file:
        authority?.kind === "markdown" && authority.phase === "ready"
          ? { hostId: authority.hostId, path: authority.path }
          : null,
      catalog: authority
        ? { status: "not-applicable", boards: [], hasMore: false }
        : catalog,
    });
  }
  return {
    read,
    async select(
      input: { botId: string; expectedRevision: number; boardId: string },
      signal?: AbortSignal,
    ) {
      const value = taskSettingsContract.taskBoardSelect.input.parse(input);
      check(signal);
      await source.select(
        {
          ...value,
          author: "user:bot-settings",
          reason: "Explicit initial Tasks board selection in bot settings",
        },
        signal,
      );
      check(signal);
      return read({ botId: value.botId }, signal);
    },
  };
}
