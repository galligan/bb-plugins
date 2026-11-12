// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMachine } from "./native-controls.ts";
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
  setPageVisible(true);
});

function setPageVisible(visible: boolean) {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("registers an additive panel and owned-only header without replacing navigation or composer", async () => {
  const app = await loaded();
  expect(app.navPanels).toHaveLength(1);
  expect(app.navPanels[0]!.headerContent).toBeTypeOf("function");
  expect(app.navPanels[0]!.experimental_usePageTitle).toBeTypeOf("function");
  expect(app.settingsSections).toHaveLength(1);
  expect(app.threadActions).toHaveLength(1);
  expect(app.experimentalSidebarNavigations).toHaveLength(0);
  expect(app.threadLists).toHaveLength(0);
  expect(app.composerCustomizations).toHaveLength(1);
  expect(app.composerCustomizations[0]!.scopes).toEqual(["thread"]);
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
  await userEvent.click(slot.getByRole("button", { name: "Retry bot read" }));
  await slot.findByText("No bots yet. Create Bob or choose another name.");
  slot.lifecycle.unmount();
});

test("navigation panel reads and creation work without a secondary-tab visibility context", async () => {
  const app = await loaded();
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      // Native nav panels are not secondary tabs. That hook defaults false there.
      tabVisible: false,
      rpc: { list: () => ({ bots: [view.bot], hasMore: false }) },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  expect(slot.queryByRole("button", { name: "Open Bob" })).toBeNull();
  await chooseMachine(slot);
  expect(
    (slot.getByRole("button", { name: "Create bot" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  slot.lifecycle.unmount();
});

test("browser hide aborts machine discovery and stale responses cannot unlock creation", async () => {
  const app = await loaded();
  let resolve!: (machines: (typeof machine)[]) => void;
  let signal: AbortSignal | undefined;
  let reads = 0;
  let lists = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      tabVisible: false,
      rpc: {
        list: () => {
          lists++;
          return { bots: [], hasMore: false };
        },
      },
      sdk: {
        hosts: {
          list: async (args) => {
            signal = args?.signal;
            reads++;
            if (reads > 1) return [machine];
            return new Promise<(typeof machine)[]>((yes) => {
              resolve = yes;
            });
          },
        },
      },
    },
  );
  await waitFor(() => expect(reads).toBe(1));
  setPageVisible(false);
  expect(signal?.aborted).toBe(true);
  const before = lists;
  await act(async () => resolve([machine]));
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(lists).toBe(before);
  expect(slot.queryByRole("option", { name: "Fixture machine" })).toBeNull();
  expect(
    (slot.getByRole("button", { name: "Create bot" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  setPageVisible(true);
  await chooseMachine(slot);
  expect(
    (slot.getByRole("button", { name: "Create bot" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  slot.lifecycle.unmount();
  expect(signal?.aborted).toBe(true);
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
        name: "Check setup",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.click(
    slot.getByRole("button", { name: "Open conversation" }),
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
          name: "Check setup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await userEvent.click(slot.getByRole("button", { name: "Check setup" }));
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
  expect(slot.queryByRole("button", { name: "Open conversation" })).toBeNull();
  slot.lifecycle.unmount();
});

test("refresh failure preserves loaded bots while reporting the failed read", async () => {
  const app = await loaded();
  let fail = false;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
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
  await slot.findByRole("button", { name: "Open Bob" });
  fail = true;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText(
    "Could not load bots. Check the connection and refresh.",
  );
  expect(slot.getByRole("button", { name: "Open Bob" })).toBeTruthy();
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
  await waitFor(() =>
    expect(
      (
        slot.getByRole("button", {
          name: "Check setup",
          hidden: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  const recovery = slot.getByText("Setup status and recovery");
  if (!(recovery.parentElement as HTMLDetailsElement).open)
    await userEvent.click(recovery);
  const resume = await slot.findByRole("button", { name: "Check setup" });
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
