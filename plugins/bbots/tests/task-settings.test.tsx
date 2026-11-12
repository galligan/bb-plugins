// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsFixture } from "./settings-fixture.test.ts";
import { view } from "./fixture.ts";
import {
  taskSettingsContract,
  type TaskSettingsState,
} from "../lib/tasks/settings-contracts.ts";

const original = { id: "tracker_stable", name: "Shared work", prefix: "WORK" };
const initial: TaskSettingsState = {
  botId: "bot_test",
  revision: 0,
  kind: "unconfigured",
  availability: "unconfigured",
  board: null,
  file: null,
  catalog: { status: "available", boards: [original], hasMore: false },
};
const configured: TaskSettingsState = {
  ...initial,
  revision: 1,
  kind: "tasks",
  availability: "available",
  board: original,
  catalog: { status: "not-applicable", boards: [], hasMore: false },
};
function visibility(visible: boolean) {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
afterEach(() => {
  cleanup();
  visibility(true);
});

async function choose(
  slot: Awaited<ReturnType<typeof settingsFixture>>["slot"],
) {
  const control = await slot.findByRole("combobox", { name: "Board" });
  control.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(
    await screen.findByRole("option", { name: "Shared work · WORK" }),
  );
}

test("native settings start with no chosen board and submit only the deliberate stable ID and current revision", async () => {
  let current = initial;
  const writes: unknown[] = [];
  const { slot } = await settingsFixture({
    taskSettings: () => current,
    taskBoardSelect: (input) => {
      const value = taskSettingsContract.taskBoardSelect.input.parse(input);
      writes.push(value);
      current = configured;
      return current;
    },
  });
  const save = await slot.findByRole("button", { name: "Use selected board" });
  expect(save.matches(":disabled")).toBe(true);
  expect(writes).toHaveLength(0);
  await choose(slot);
  await userEvent.click(save);
  await slot.findByText("Task source saved.");
  expect(writes).toEqual([
    { botId: "bot_test", boardId: "tracker_stable", expectedRevision: 0 },
  ]);
  expect(slot.queryByRole("combobox", { name: "Board" })).toBeNull();
  expect(slot.queryByRole("button", { name: "Open Tasks board" })).toBeNull();
  expect(slot.getByText(/Tasks board: Shared work/)).toBeTruthy();
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  expect(
    slot.inspection.sdkCalls.some((call) => call.method.startsWith("threads.")),
  ).toBe(false);
});

test("a pending source save locks choice, filter, refresh and duplicate submit then reconciles a lost receipt by reading", async () => {
  let current = initial,
    reject!: (error: Error) => void;
  let writes = 0;
  const { slot } = await settingsFixture({
    taskSettings: () => current,
    taskBoardSelect: () => {
      writes++;
      return new Promise<never>((_yes, no) => {
        reject = no;
      });
    },
  });
  await choose(slot);
  await userEvent.type(
    slot.getByRole("searchbox", { name: "Find board" }),
    "work",
  );
  await userEvent.click(
    slot.getByRole("button", { name: "Use selected board" }),
  );
  await waitFor(() =>
    expect(
      slot.getByRole("combobox", { name: "Board" }).matches(":disabled"),
    ).toBe(true),
  );
  expect(slot.getByRole("searchbox").matches(":disabled")).toBe(true);
  expect(
    slot.getByRole("button", { name: "Refresh boards" }).matches(":disabled"),
  ).toBe(true);
  expect(
    slot.getByRole("button", { name: "Saving…" }).matches(":disabled"),
  ).toBe(true);
  current = configured;
  reject(new Error("Lost receipt after commit"));
  await slot.findByText(/Could not confirm the task source save/);
  expect((slot.getByRole("searchbox") as HTMLInputElement).value).toBe("work");
  expect(slot.getByRole("combobox", { name: "Board" }).textContent).toContain(
    "Shared work",
  );
  expect(
    slot
      .getByRole("button", { name: "Use selected board" })
      .matches(":disabled"),
  ).toBe(true);
  await userEvent.click(
    slot.getByRole("button", { name: "Read saved task source" }),
  );
  await slot.findByText(/Tasks board: Shared work/);
  expect(writes).toBe(1);
  expect(slot.queryByRole("combobox", { name: "Board" })).toBeNull();
});

test("filtering and refresh keep an explicit choice without automatically choosing a different matching board", async () => {
  let current = initial;
  const writes: unknown[] = [];
  const { slot } = await settingsFixture({
    taskSettings: () => current,
    taskBoardSelect: (input) => {
      writes.push(input);
      return configured;
    },
  });
  await choose(slot);
  current = {
    ...initial,
    catalog: { status: "available", boards: [], hasMore: false },
  };
  await userEvent.type(slot.getByRole("searchbox"), "no match");
  await slot.findByText("No boards match this search.");
  expect(slot.getByRole("combobox", { name: "Board" }).textContent).toContain(
    "Shared work",
  );
  await userEvent.click(slot.getByRole("button", { name: "Refresh boards" }));
  expect((slot.getByRole("searchbox") as HTMLInputElement).value).toBe(
    "no match",
  );
  await userEvent.click(
    slot.getByRole("button", { name: "Use selected board" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ boardId: "tracker_stable" });
});

test("empty, unavailable and failed reads provide distinct recovery states with no fallback or implicit writes", async () => {
  let unavailable = false,
    fail = false;
  const { slot } = await settingsFixture({
    taskSettings: () => {
      if (fail) throw new Error("Connection lost");
      return {
        ...initial,
        catalog: {
          status: unavailable ? "unavailable" : "available",
          boards: [],
          hasMore: false,
        },
      };
    },
  });
  await slot.findByText(/No Tasks boards yet/);
  unavailable = true;
  await userEvent.click(slot.getByRole("button", { name: "Refresh boards" }));
  await slot.findByText(/Could not load Tasks boards/);
  expect(slot.queryByText(/No Tasks boards yet/)).toBeNull();
  expect(
    slot.getByRole("combobox", { name: "Board" }).matches(":disabled"),
  ).toBe(true);
  fail = true;
  await userEvent.click(slot.getByRole("button", { name: "Refresh boards" }));
  await slot.findByRole("button", { name: "Retry task source read" });
  expect(
    slot
      .getByRole("button", { name: "Use selected board" })
      .matches(":disabled"),
  ).toBe(true);
  fail = false;
  unavailable = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry task source read" }),
  );
  await slot.findByText(/No Tasks boards yet/);
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "taskBoardSelect"),
  ).toBe(false);
});

test("hidden settings pause subscriptions and refuse manual source saves until visible again", async () => {
  let reads = 0,
    writes = 0;
  const { slot } = await settingsFixture({
    taskSettings: () => {
      reads++;
      return initial;
    },
    taskBoardSelect: () => {
      writes++;
      return configured;
    },
  });
  await choose(slot);
  const before = reads;
  visibility(false);
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(reads).toBe(before);
  expect(
    slot
      .getByRole("button", { name: "Use selected board" })
      .matches(":disabled"),
  ).toBe(true);
  await userEvent.click(
    slot.getByRole("button", { name: "Use selected board" }),
  );
  expect(writes).toBe(0);
  visibility(true);
  await waitFor(() => expect(reads).toBeGreaterThan(before));
  expect(slot.getByRole("combobox", { name: "Board" }).textContent).toContain(
    "Shared work",
  );
});

test("an established file remains read-only with its original host link, not a board replacement control", async () => {
  const { slot } = await settingsFixture({
    taskSettings: () => ({
      ...initial,
      revision: 2,
      kind: "markdown",
      availability: "available",
      file: { hostId: "host_original", path: "/original/home/tasks.md" },
      catalog: { status: "not-applicable", boards: [], hasMore: false },
    }),
  });
  await userEvent.click(
    await slot.findByRole("link", { name: "Open tasks.md" }),
  );
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "host",
        hostId: "host_original",
        path: "/original/home/tasks.md",
      },
      location: null,
    },
  });
  expect(slot.queryByRole("combobox", { name: "Board" })).toBeNull();
  expect(
    slot.getByText(
      /Changing an established source requires an inspected migration/,
    ),
  ).toBeTruthy();
});

test("switching bots cannot apply a late save acknowledgement or its board choice to the new bot", async () => {
  let resolve!: (state: TaskSettingsState) => void;
  const writes: unknown[] = [];
  const other = { ...view.bot, id: "bot_alice", name: "Alice" };
  const { slot } = await settingsFixture({
    list: () => ({ bots: [view.bot, other], hasMore: false }),
    show: (input) => {
      const { botId } = input as { botId: string };
      return { ...view, bot: botId === other.id ? other : view.bot };
    },
    taskSettings: (input) => ({
      ...initial,
      botId: (input as { botId: string }).botId,
    }),
    taskBoardSelect: (input) => {
      writes.push(input);
      return new Promise<TaskSettingsState>((yes) => {
        resolve = yes;
      });
    },
  });
  await choose(slot);
  await userEvent.click(
    slot.getByRole("button", { name: "Use selected board" }),
  );
  await slot.findByRole("button", { name: "Saving…" });
  slot.getByRole("combobox", { name: "Bot" }).focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(await screen.findByRole("option", { name: "Alice" }));
  await slot.findByRole("button", { name: "Use selected board" });
  await act(async () => {
    resolve(configured);
  });
  expect(slot.getByRole("combobox", { name: "Board" }).textContent).toBe(
    "Choose a board",
  );
  expect(
    slot
      .getByRole("button", { name: "Use selected board" })
      .matches(":disabled"),
  ).toBe(true);
  expect(slot.queryByText("Task source saved.")).toBeNull();
  expect(writes).toEqual([
    { botId: "bot_test", boardId: "tracker_stable", expectedRevision: 0 },
  ]);
});
