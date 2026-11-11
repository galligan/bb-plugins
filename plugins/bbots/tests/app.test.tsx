// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { view, soul } from "./fixture.ts";
import {
  experimental_makePanelController,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";

const loaded = () => loadPluginApp(() => import("../app.tsx"));
const machine = makeHostResponse({
  id: "host_test",
  name: "Fixture machine",
  status: "connected",
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

test("registers an additive panel and owned-only header without replacing navigation or composer", async () => {
  const app = await loaded();
  expect(app.navPanels).toHaveLength(1);
  expect(app.threadActions).toHaveLength(1);
  expect(app.experimentalSidebarNavigations).toHaveLength(0);
  expect(app.threadLists).toHaveLength(0);
  expect(app.composerCustomizations).toHaveLength(0);
  const action = app.threadActions[0]!;
  expect(action.placement).toBe("header");
  function Header() {
    const sdk = useSdk(),
      navigate = useBbNavigate();
    const data = action.useData?.({ threadIds: ["thr_owned", "thr_foreign"] });
    const target = {
      id: "thr_owned",
      projectId: "proj_home",
      parentThreadId: null,
      parentNotifications: "off" as const,
      archivedAt: null,
      pinnedAt: null,
      sectionId: null,
      isUnread: false,
      status: "idle" as const,
      environment: null,
    };
    const mine = action.item({
      thread: target,
      data,
      sdk,
      navigate,
      experimental_panel: experimental_makePanelController(),
    });
    const foreign = action.item({
      thread: { ...target, id: "thr_foreign" },
      data,
      sdk,
      navigate,
      experimental_panel: experimental_makePanelController(),
    });
    return (
      <>
        {mine && (
          <button onClick={() => void mine.run({ requestRename: () => {} })}>
            {mine.label}
          </button>
        )}
        {foreign && <span>Unexpected foreign owner</span>}
      </>
    );
  }
  const slot = renderSlot(
    { component: Header },
    {},
    {
      rpc: {
        ownership: () => ({
          thr_owned: { botId: "bot_test", name: "Bob", role: "main" },
          thr_foreign: null,
        }),
      },
    },
  );
  const button = await slot.findByRole("button", { name: "@Bob" });
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(slot.queryByText("Unexpected foreign owner")).toBeNull();
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "bots",
    options: { subPath: "bot_test" },
  });
  slot.lifecycle.unmount();
});

test("read failure is distinct from empty and retry restores the list", async () => {
  const app = await loaded();
  let fail = true;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        list: () => {
          if (fail) throw new Error("Offline");
          return { bots: [], hasMore: false };
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByText(
    "Could not load bots. Check the connection and refresh.",
  );
  expect(
    slot.queryByText("No bots yet. Create Bob or choose another name."),
  ).toBeNull();
  fail = false;
  await userEvent.click(slot.getByRole("button", { name: "Refresh" }));
  await slot.findByText("No bots yet. Create Bob or choose another name.");
  slot.lifecycle.unmount();
});

test("native open preserves the host conversation and offline setup is actionable", async () => {
  const app = await loaded();
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "bot_test" },
    {
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        show: () => view,
        soulShow: () => soul,
      },
      sdk: {
        hosts: { list: async () => [{ ...machine, status: "disconnected" }] },
      },
    },
  );
  await slot.findByText(
    "The recorded machine is offline or unavailable. Reconnect it; the original home will be preserved.",
  );
  expect(
    (
      slot.getByRole("button", {
        name: "Check / resume setup",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.click(
    slot.getByRole("button", { name: "Open ongoing conversation" }),
  );
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toThread",
    threadId: "thr_owned",
  });
  expect(
    slot.inspection.sdkCalls.filter((call) =>
      call.method.startsWith("threads."),
    ),
  ).toHaveLength(0);
  slot.lifecycle.unmount();
});

test("partial setup prevents duplicate resume while pending and retains its state after a failed write", async () => {
  const app = await loaded();
  let reject!: (error: Error) => void;
  let writes = 0;
  const partial = {
    ...view,
    main: { ...view.main, threadId: null },
    setup: {
      ...view.setup,
      phase: "planned",
      homePath: null,
      error: "Restore the original machine before continuing.",
    },
  };
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "bot_test" },
    {
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        show: () => partial,
        soulShow: () => soul,
        resume: () => {
          writes++;
          return new Promise((_, no) => {
            reject = no;
          });
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByText("Setup needs attention");
  await waitFor(() =>
    expect(
      (
        slot.getByRole("button", {
          name: "Check / resume setup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await userEvent.click(
    slot.getByRole("button", { name: "Check / resume setup" }),
  );
  const pending = await slot.findByRole("button", { name: "Checking setup…" });
  await userEvent.click(pending);
  expect(writes).toBe(1);
  reject(new Error("Connection lost"));
  await slot.findByText(
    "Could not confirm setup. Check the recorded state before trying again; no duplicate prompt is sent by resume.",
  );
  expect(
    slot.getByText("Restore the original machine before continuing."),
  ).toBeTruthy();
  expect(
    slot.queryByRole("button", { name: "Open ongoing conversation" }),
  ).toBeNull();
  slot.lifecycle.unmount();
});

test("refresh failure preserves loaded bots and malformed links do not crash the panel", async () => {
  const app = await loaded();
  let fail = false;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "%invalid" },
    {
      rpc: {
        list: () => {
          if (fail) throw new Error("Offline");
          return { bots: [view.bot], hasMore: false };
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByRole("button", { name: "Bob" });
  expect(
    slot.getByText("This bot link is invalid. Select a bot from the list."),
  ).toBeTruthy();
  fail = true;
  await userEvent.click(slot.getByRole("button", { name: "Refresh" }));
  await slot.findByText(
    "Could not load bots. Check the connection and refresh.",
  );
  expect(slot.getByRole("button", { name: "Bob" })).toBeTruthy();
  slot.lifecycle.unmount();
});

test("a later authoritative setup error is not hidden by an earlier successful resume", async () => {
  const app = await loaded();
  let current = view;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "bot_test" },
    {
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        show: () => current,
        soulShow: () => soul,
        resume: () => view,
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  const resume = await slot.findByRole("button", {
    name: "Check / resume setup",
  });
  await waitFor(() =>
    expect((resume as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(resume);
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "resume"),
    ).toHaveLength(1),
  );
  await waitFor(() =>
    expect((resume as HTMLButtonElement).disabled).toBe(false),
  );
  current = {
    ...view,
    setup: {
      ...view.setup,
      error: "Recorded home is missing. Restore it before continuing.",
    },
  };
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText(
    "Recorded home is missing. Restore it before continuing.",
  );
  expect(slot.getByText("Setup needs attention")).toBeTruthy();
  slot.lifecycle.unmount();
});
