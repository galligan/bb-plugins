// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseMachine } from "./native-controls.ts";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { view } from "./fixture.ts";
import { createSchema } from "../lib/setup/contracts.ts";
import { provider, execution } from "./execution-fixture.ts";
import { useState } from "react";
import { ExecutionChoice } from "../components/execution-choice.tsx";
import { experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
const loaded = () => loadPluginApp(() => import("../app.tsx"));

test.each([
  { providerId: "missing" },
  { providerId: "codex", model: "removed-model" },
  { providerId: "codex", permissionMode: "full" as const },
])(
  "unavailable saved choices permit an explicit replacement without changing the draft on display: %j",
  async (initial) => {
    const changes: unknown[] = [];
    const slot = renderSlot(
      {
        component: () => (
          <ExecutionChoice
            hostId="host_test"
            initial={initial}
            onChoosing={() => {}}
            onChange={(value) => changes.push(value)}
          />
        ),
      },
      {},
      {
        sdk: {
          providers: {
            list: async () => [provider],
            models: async () => execution,
          },
        },
      },
    );
    await slot.findByRole("alert");
    expect(changes).toEqual([]);
    await userEvent.click(
      slot.getByRole("button", { name: "Choose available replacement" }),
    );
    await slot.findByTestId("bb-provider-model-picker");
    expect(changes).toEqual([]);
    await userEvent.click(
      slot.getByRole("button", { name: "Apply execution selection" }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      providerId: "codex",
      model: "gpt-6.1-sol",
      permissionMode: "accept-edits",
    });
  },
);
const machine = makeHostResponse({
  id: "host_test",
  name: "Fixture machine",
  status: "connected",
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

test("custom creation forwards the native none reasoning value without inventing another level", async () => {
  const app = await loaded();
  const writes: ReturnType<typeof createSchema.parse>[] = [];
  const noReasoning = {
    ...execution,
    models: execution.models.map((model) => ({
      ...model,
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [],
    })),
  };
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
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
          models: async () => noReasoning,
        },
      },
    },
  );
  await chooseMachine(slot);
  await userEvent.click(
    slot.getByRole("checkbox", { name: "Choose a model and permissions" }),
  );
  await slot.findByTestId("bb-provider-model-picker");
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.reasoningLevel).toBe("none");
});

test("a known pre-intent refusal preserves visible custom execution choices when the form returns", async () => {
  const app = await loaded();
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "new" },
    {
      rpc: {
        creation: () => null,
        create: () => {
          throw new RpcCallError({
            code: "invalid",
            message:
              "Home validation failed before saving creation intent: fixture refusal",
          });
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
  await chooseMachine(slot);
  await userEvent.click(
    slot.getByRole("checkbox", { name: "Choose a model and permissions" }),
  );
  await slot.findByTestId("bb-provider-model-picker");
  await userEvent.selectOptions(slot.getByLabelText("Service tier"), "fast");
  await userEvent.click(
    slot.getByRole("button", { name: "Apply execution selection" }),
  );
  await userEvent.click(slot.getByRole("button", { name: "Create bot" }));
  await slot.findByText(
    "Home validation failed before saving creation intent: fixture refusal",
  );
  expect(
    slot
      .getByRole("checkbox", { name: "Choose a model and permissions" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await slot.findByTestId("bb-provider-model-picker");
  expect((slot.getByLabelText("Service tier") as HTMLSelectElement).value).toBe(
    "fast",
  );
});

test("rereading an existing native choice after a parent rerender emits no setting change", async () => {
  let changes = 0;
  function Display() {
    const [version, setVersion] = useState(0);
    return (
      <>
        <button onClick={() => setVersion(version + 1)}>Reread display</button>
        <ExecutionChoice
          hostId="host_test"
          initial={{
            providerId: "codex",
            model: "gpt-6.1-sol",
            permissionMode: "accept-edits",
          }}
          onChoosing={() => {}}
          onChange={() => {
            changes++;
          }}
        />
      </>
    );
  }
  const slot = renderSlot(
    { component: Display },
    {},
    {
      sdk: {
        providers: {
          list: async () => [provider],
          models: async () => execution,
        },
      },
    },
  );
  await slot.findByTestId("bb-provider-model-picker");
  expect(changes).toBe(0);
  await userEvent.click(slot.getByRole("button", { name: "Reread display" }));
  await waitFor(() =>
    expect(
      slot.inspection.sdkCalls.filter(
        (call) => call.method === "providers.models",
      ),
    ).toHaveLength(2),
  );
  await slot.findByTestId("bb-provider-model-picker");
  expect(changes).toBe(0);
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
  await chooseMachine(slot);
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
    await chooseMachine(slot);
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
