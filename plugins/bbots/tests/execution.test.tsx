// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { view } from "./fixture.ts";
import { createSchema } from "../lib/setup/contracts.ts";
import { provider, execution } from "./execution-fixture.ts";
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

test("native execution pickers route to the selected host and forward coherent model/reasoning/tier/permissions", async () => {
  const app = await loaded();
  const writes: ReturnType<typeof createSchema.parse>[] = [];
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [], hasMore: false }),
        creation: () => null,
        create: (input) => {
          writes.push(createSchema.parse(input));
          return view;
        },
      },
      sdk: {
        hosts: { list: async () => [machine] },
        providers: {
          list: async () => [provider],
          models: async () => execution,
        },
      },
    },
  );
  await slot.findByRole("option", { name: "Fixture machine" });
  await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
  await userEvent.click(slot.getByLabelText("Choose a model and permissions"));
  const picker = await slot.findByTestId("bb-provider-model-picker");
  expect(picker.getAttribute("data-routing-id")).toBe("host_test");
  const permissions = slot.getByTestId("bb-permission-mode-picker");
  expect(permissions.getAttribute("data-routing-id")).toBe("host_test");
  await userEvent.selectOptions(slot.getByLabelText("Permission mode"), "auto");
  await userEvent.selectOptions(slot.getByLabelText("Service tier"), "fast");
  await userEvent.click(
    slot.getByRole("button", { name: "Apply execution selection" }),
  );
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    hostId: "host_test",
    providerId: "codex",
    model: "gpt-6.1-sol",
    reasoningLevel: "high",
    serviceTier: "fast",
    permissionMode: "auto",
  });
  slot.lifecycle.unmount();
});

test.each(["empty", "failed"])(
  "custom model selection skips a %s first catalog and reaches a usable provider",
  async (failure) => {
    const app = await loaded();
    const first = { ...provider, id: "first", displayName: "First" };
    const attempted: string[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "new" },
      {
        rpc: { list: () => ({ bots: [], hasMore: false }) },
        sdk: {
          hosts: { list: async () => [machine] },
          providers: {
            list: async () => [first, provider],
            models: async (args) => {
              attempted.push(args?.providerId ?? "");
              if (args?.providerId === "first") {
                if (failure === "failed")
                  throw new Error("Catalog unavailable");
                return { ...execution, models: [] };
              }
              return execution;
            },
          },
        },
      },
    );
    await slot.findByRole("option", { name: "Fixture machine" });
    await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
    await userEvent.click(
      slot.getByLabelText("Choose a model and permissions"),
    );
    await slot.findByTestId("bb-provider-model-picker");
    expect((slot.getByLabelText("Provider ID") as HTMLInputElement).value).toBe(
      "codex",
    );
    expect(attempted).toEqual(["first", "codex"]);
    expect(
      (slot.getByRole("button", { name: "Create bot" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    slot.lifecycle.unmount();
  },
);
