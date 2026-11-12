// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  BotRecordsPanel,
  useRecordsVisible,
  recordsTab,
} from "../components/records/panel.tsx";
import {
  recordsFixture,
  recordOwner,
  recordIndex,
} from "./records-fixture.test.ts";

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

test.each([true, false])(
  "Info opens only the registered native tab and handles host acceptance=%s without changing execution",
  async (accepted) => {
    const app = await loadPluginApp(() => import("../app.tsx"));
    expect(app.tabs).toHaveLength(1);
    expect(app.tabs[0]).toMatchObject({
      ...recordsTab,
      title: "Bot records",
      component: BotRecordsPanel,
      useVisible: useRecordsVisible,
    });
    const row = app.threadInfoRows.find((value) => value.id === "bot-records")!;
    const slot = renderSlot(
      row,
      { threadId: "thr_owned", projectId: "proj_home", environment: null },
      {
        tabVisible: false,
        rpc: { ownership: () => ({ thr_owned: recordOwner }) },
        experimental_panel: { openTab: () => accepted },
        composer: { text: "Retain this draft", attachmentCount: 1 },
      },
    );
    await userEvent.click(
      await slot.findByRole("button", {
        name: "Inspect memories and checkpoints",
      }),
    );
    expect(slot.inspection.experimental_panelCalls).toEqual([
      { method: "openTab", options: { tab: recordsTab } },
    ]);
    if (!accepted) await slot.findByText(/could not open Bot records/);
    else expect(slot.queryByText(/could not open Bot records/)).toBeNull();
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("Retain this draft");
    expect(slot.inspection.composer.attachmentCount).toBe(1);
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.inspection.sdkCalls).toHaveLength(0);
  },
);

test("an actual hidden native tab does no heavy record reads even though its owned Info identity can resolve", async () => {
  const { slot } = await recordsFixture({ tabVisible: false });
  await slot.findByText("Record reads pause while this tab is hidden.");
  expect(
    slot.inspection.rpcCalls.every((call) => call.method === "ownership"),
  ).toBe(true);
  expect(slot.queryByRole("searchbox")).toBeNull();
});

test("unowned conversation cannot expose records or its Info action", async () => {
  const { app, slot } = await recordsFixture({
    rpc: { ownership: () => ({ thr_owned: null }) },
  });
  await slot.findByText(
    "Open Bot records from an owned main or worker conversation.",
  );
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "botRecords"),
  ).toBe(false);
  const info = renderSlot(
    app.threadInfoRows.find((row) => row.id === "bot-records")!,
    { threadId: "thr_foreign", projectId: "proj_home", environment: null },
    { rpc: { ownership: () => ({ thr_foreign: null }) } },
  );
  expect(info.queryByRole("button")).toBeNull();
  expect(info.inspection.sdkCalls).toHaveLength(0);
});

test("backgrounding retains the matching native tab identity while heavy reads stop and search draft survives", async () => {
  let ownerReads = 0;
  function Host() {
    const shown = useRecordsVisible({
      threadId: "thr_owned",
      environment: null,
    });
    return (
      <>
        <span>{shown ? "Tab retained" : "Tab hidden"}</span>
        <BotRecordsPanel threadId="thr_owned" environment={null} />
      </>
    );
  }
  const slot = renderSlot(
    { component: Host },
    {},
    {
      rpc: {
        ownership: () => {
          ownerReads++;
          return { thr_owned: recordOwner };
        },
        botRecords: () => recordIndex,
      },
    },
  );
  const search = await slot.findByRole("searchbox", { name: "Search memory" });
  await userEvent.type(search, "Unsaved search");
  const before = slot.inspection.rpcCalls.length;
  visibility(false);
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(slot.getByText("Tab retained")).toBeTruthy();
  expect(slot.inspection.rpcCalls).toHaveLength(before);
  visibility(true);
  await waitFor(() => expect(ownerReads).toBeGreaterThan(1));
  expect(((await slot.findByRole("searchbox")) as HTMLInputElement).value).toBe(
    "Unsaved search",
  );
});

test("an ownership-read failure keeps the known tab available for recovery but refuses its content", async () => {
  let fail = false;
  function Host() {
    const shown = useRecordsVisible({
      threadId: "thr_owned",
      environment: null,
    });
    return (
      <>
        <span>{shown ? "Tab retained" : "Tab hidden"}</span>
        <BotRecordsPanel threadId="thr_owned" environment={null} />
      </>
    );
  }
  const slot = renderSlot(
    { component: Host },
    {},
    {
      rpc: {
        ownership: () => {
          if (fail) throw new Error("Disconnected");
          return { thr_owned: recordOwner };
        },
        botRecords: () => recordIndex,
      },
    },
  );
  await slot.findByText("A bounded excerpt.");
  fail = true;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText("Could not verify this conversation's bot ownership.");
  expect(slot.getByText("Tab retained")).toBeTruthy();
  expect(slot.queryByText("A bounded excerpt.")).toBeNull();
  fail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry ownership read" }),
  );
  await slot.findByText("A bounded excerpt.");
});

test("a late previous-thread response cannot expose Bob's records after the native pane switches to Alice", async () => {
  let resolve!: (value: typeof recordIndex) => void;
  let resolveAlice!: (value: typeof recordIndex) => void;
  const { slot } = await recordsFixture({
    rpc: {
      ownership: (input) =>
        Object.fromEntries(
          (input as { keys: string[] }).keys.map((key) => [
            key,
            key === "thr_owned"
              ? recordOwner
              : { ...recordOwner, botId: "bot_alice", name: "Alice" },
          ]),
        ),
      botRecords: (input) =>
        (input as { threadId: string }).threadId === "thr_owned"
          ? new Promise<typeof recordIndex>((yes) => {
              resolve = yes;
            })
          : new Promise<typeof recordIndex>((yes) => {
              resolveAlice = yes;
            }),
    },
  });
  await slot.findByText("Reading bot records…");
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  slot.lifecycle.rerender(
    <BotRecordsPanel threadId="thr_alice" environment={null} />,
  );
  await slot.findByText(/@Alice's retained records/);
  await waitFor(() => expect(resolveAlice).toBeTypeOf("function"));
  await act(async () => {
    resolve(recordIndex);
  });
  expect(slot.queryByText("A bounded excerpt.")).toBeNull();
  expect(slot.queryByText("Before edits")).toBeNull();
  await act(async () => {
    resolveAlice({
      ...recordIndex,
      threadId: "thr_alice",
      botId: "bot_alice",
      name: "Alice",
      memory: { items: [], nextCursor: null },
      checkpoints: { items: [], nextCursor: null },
    });
  });
  await slot.findByText("No retrievable records of this kind yet.");
});
