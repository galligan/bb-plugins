// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { view } from "./fixture.ts";

afterEach(cleanup);

test("the actual host header owns collection refresh/create and entity settings navigation", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  let reads = 0;
  const header = app.navPanels[0]!.headerContent!;
  const collection = renderSlot(
    { component: header },
    { subPath: "" },
    {
      rpc: {
        list: () => {
          reads++;
          return { bots: [view.bot], hasMore: false };
        },
      },
    },
  );
  const refresh = await collection.findByRole("button", {
    name: "Refresh bots",
  });
  await waitFor(() =>
    expect((refresh as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(refresh);
  await waitFor(() => expect(reads).toBe(2));
  await userEvent.click(collection.getByRole("button", { name: "New bot" }));
  expect(collection.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "bots",
    options: { subPath: "new" },
  });
  collection.lifecycle.unmount();
  const entity = renderSlot({ component: header }, { subPath: "bot_test" });
  await userEvent.click(entity.getByRole("button", { name: "Bot settings" }));
  expect(entity.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "bots",
    options: { subPath: "bot_test/settings" },
  });
  await userEvent.click(entity.getByRole("button", { name: "Back to bots" }));
  expect(entity.inspection.navigateCalls).toContainEqual(
    expect.objectContaining({ method: "toPluginPanel", path: "bots" }),
  );
});

test("host title breadcrumbs identify the selected bot settings and malformed links make no entity read", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const useTitle = app.navPanels[0]!.experimental_usePageTitle!;
  function Title() {
    return (
      <span>{JSON.stringify(useTitle({ subPath: "bot_test/settings" }))}</span>
    );
  }
  const title = renderSlot(
    { component: Title },
    {},
    { rpc: { show: () => view } },
  );
  await title.findByText(/Bob/);
  expect(title.getByText(/Settings/)).toBeTruthy();
  title.lifecycle.unmount();
  const invalid = renderSlot(app.navPanels[0]!, {
    subPath: "%invalid/settings",
  });
  await invalid.findByText(
    "This bot link is invalid. Return to Bots and select a collaborator.",
  );
  expect(invalid.inspection.rpcCalls).toHaveLength(0);
});
