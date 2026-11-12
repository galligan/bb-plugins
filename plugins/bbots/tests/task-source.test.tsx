// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { view, soul } from "./fixture.ts";

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
async function render(taskSource: () => unknown) {
  visibility(true);
  const app = await loadPluginApp(() => import("../app.tsx"));
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "bot_test" },
    {
      tabVisible: false,
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        show: () => view,
        soulShow: () => soul,
        taskSource,
      },
      sdk: {
        hosts: {
          list: async () => [
            makeHostResponse({ id: "host_test", status: "connected" }),
          ],
        },
      },
    },
  );
}

test("a source changed during a read offers an explicit retry without opening an unverified destination", async () => {
  const slot = await render(() => ({
    kind: "tasks",
    availability: "changed-during-read",
    boardId: "tracker_new",
    file: null,
  }));
  await slot.findByText(
    "Task authority changed during this read. Read the current source again.",
  );
  expect(slot.queryByRole("button", { name: "Open Tasks board" })).toBeNull();
  expect(slot.queryByRole("link", { name: "Open tasks.md" })).toBeNull();
  expect(
    slot.getByRole("button", { name: "Retry task source read" }),
  ).toBeTruthy();
});

test("actual nav entry opens the Markdown source with its explicit host, not the selected workspace", async () => {
  const slot = await render(() => ({
    kind: "markdown",
    availability: "available",
    boardId: null,
    file: { hostId: "host_original", path: "/home/bob/tasks.md" },
  }));
  await userEvent.click(
    await slot.findByRole("link", { name: "Open tasks.md" }),
  );
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "host",
        hostId: "host_original",
        path: "/home/bob/tasks.md",
      },
      location: null,
    },
  });
  expect(slot.queryByText(/tasks? (count|total)/i)).toBeNull();
});

test("configured Tasks gives native navigation guidance instead of routing to another plugin through a Bots-only API", async () => {
  const slot = await render(() => ({
    kind: "tasks",
    availability: "available",
    boardId: "tracker_original",
    file: null,
  }));
  await slot.findByText(/Open Tasks in BB to view its work/);
  expect(slot.queryByRole("button", { name: "Open Tasks board" })).toBeNull();
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  expect(
    slot.inspection.sdkCalls.filter((call) =>
      call.method.startsWith("projects."),
    ),
  ).toHaveLength(0);
});

test("source outage is actionable, never rendered as an empty task list or a fallback", async () => {
  const slot = await render(() => ({
    kind: "markdown",
    availability: "unavailable",
    boardId: null,
    file: { hostId: "host_original", path: "/home/bob/tasks.md" },
  }));
  await slot.findByText(
    "The task file is unavailable. Reconnect its machine or restore the original file.",
  );
  expect(slot.queryByRole("link", { name: "Open tasks.md" })).toBeNull();
  expect(slot.queryByRole("button", { name: "Open Tasks board" })).toBeNull();
  expect(
    slot.getByRole("button", { name: "Retry task source read" }),
  ).toBeTruthy();
});

test("new task-source reads pause when the document hides and resume without relying on panel-tab context", async () => {
  let reads = 0;
  const slot = await render(() => {
    reads++;
    return {
      kind: "tasks",
      availability: "available",
      boardId: "tracker_original",
      file: null,
    };
  });
  await slot.findByText(/Open Tasks in BB to view its work/);
  const before = reads;
  visibility(false);
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(reads).toBe(before);
  visibility(true);
  await waitFor(() => expect(reads).toBeGreaterThan(before));
});

test("an unconfigured source opens this bot's own settings without creating authority or work", async () => {
  const slot = await render(() => ({
    kind: "unconfigured",
    availability: "unconfigured",
    boardId: null,
    file: null,
  }));
  await userEvent.click(
    await slot.findByRole("button", { name: "Set up task source" }),
  );
  expect(slot.inspection.navigateCalls).toEqual([
    {
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_test/settings" },
    },
  ]);
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "taskBoardSelect"),
  ).toBe(false);
});
