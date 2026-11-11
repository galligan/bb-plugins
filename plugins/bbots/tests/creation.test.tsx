// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { view } from "./fixture.ts";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { createSchema } from "../lib/setup/contracts.ts";
import { uiContract } from "../lib/ui/contracts.ts";
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
  vi.restoreAllMocks();
});

test("creation retains an idempotency key before one write and preserves BB execution defaults", async () => {
  const app = await loaded();
  let resolve!: (value: typeof view) => void;
  const inputs: Record<string, unknown>[] = [];
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [], hasMore: false }),
        creation: () => null,
        create: (input) => {
          const value = createSchema.parse(input);
          expect(sessionStorage.getItem("bbots.pendingCreation")).toBe(
            value.requestId,
          );
          inputs.push(value);
          return new Promise<typeof view>((yes) => {
            resolve = yes;
          });
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByRole("option", { name: "Fixture machine" });
  await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await slot.findByText("Creating your collaborator…");
  expect(inputs).toHaveLength(1);
  expect(inputs[0]?.providerId).toBeUndefined();
  expect(inputs[0]?.permissionMode).toBeUndefined();
  await userEvent.keyboard("{Enter}");
  expect(inputs).toHaveLength(1);
  resolve(view);
  await waitFor(() =>
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_test" },
    }),
  );
  expect(sessionStorage.getItem("bbots.pendingCreation")).toBeNull();
  slot.lifecycle.unmount();
});

test("uncertain creation never replays and its key survives remount for read-only recovery", async () => {
  const app = await loaded();
  let writes = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [], hasMore: false }),
        creation: () => null,
        create: () => {
          writes++;
          throw new Error("Lost reply");
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByRole("option", { name: "Fixture machine" });
  await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await slot.findByText(
    "Creation delivery is unconfirmed. Check the recorded request before creating another bot; no automatic retry was sent.",
  );
  await userEvent.click(slot.getByRole("button", { name: "Check request" }));
  expect(writes).toBe(1);
  const retained = sessionStorage.getItem("bbots.pendingCreation");
  expect(retained).toBeTruthy();
  slot.lifecycle.unmount();
  const recovered = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        creation: (input) => {
          expect(uiContract.creation.input.parse(input).requestId).toBe(
            retained,
          );
          return view;
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await userEvent.click(
    await recovered.findByRole("button", { name: "Open Bob setup" }),
  );
  expect(writes).toBe(1);
  expect(sessionStorage.getItem("bbots.pendingCreation")).toBeNull();
  expect(recovered.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "bots",
    options: { subPath: "bot_test" },
  });
  recovered.lifecycle.unmount();
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

test("relative home input is rejected before a creation intent is sent", async () => {
  const app = await loaded();
  let writes = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [], hasMore: false }),
        create: () => {
          writes++;
          return view;
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByRole("option", { name: "Fixture machine" });
  await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
  await userEvent.type(
    slot.getByLabelText("Home base (optional)"),
    "relative/home",
  );
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await slot.findByText(
    "Use an absolute home base on the selected machine, or leave it empty for the default.",
  );
  expect(writes).toBe(0);
  expect(sessionStorage.getItem("bbots.pendingCreation")).toBeNull();
  slot.lifecycle.unmount();
});

test("unavailable receipt storage prevents sending a creation request", async () => {
  const app = await loaded();
  let writes = 0;
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        list: () => ({ bots: [], hasMore: false }),
        create: () => {
          writes++;
          return view;
        },
      },
      sdk: { hosts: { list: async () => [machine] } },
    },
  );
  await slot.findByRole("option", { name: "Fixture machine" });
  await userEvent.selectOptions(slot.getByLabelText("Machine"), "host_test");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable storage");
  });
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await slot.findByText(
    "Could not retain the creation receipt in this browser. Use the CLI with an explicit request ID, or allow session storage before creating.",
  );
  expect(writes).toBe(0);
  slot.lifecycle.unmount();
});
