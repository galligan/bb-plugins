// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import consumer from "./consumer.json";

afterEach(cleanup);
const loaded = () => loadPluginApp(() => import("./app"));

test("registers one host header and shows loading, read error, retry and empty state", async () => {
  const app = await loaded();
  expect(app.navPanels).toHaveLength(1);
  expect(app.navPanels[0].headerContent).toBeTypeOf("function");
  let reject!: (reason: Error) => void;
  let fail = true;
  const slot = renderSlot(
    app.navPanels[0],
    { subPath: "" },
    {
      rpc: {
        list: () =>
          fail
            ? new Promise((_, no) => {
                reject = no;
              })
            : [],
      },
    },
  );
  await slot.findByText("Loading items…");
  reject(new Error("Unavailable"));
  await slot.findByRole("alert");
  expect(slot.queryByText(consumer.empty)).toBeNull();
  fail = false;
  await userEvent.click(slot.getByRole("button", { name: "Retry" }));
  await slot.findByText(consumer.empty);
  slot.lifecycle.unmount();
});

test("retains loaded rows on refresh failure and prevents duplicate writes while preserving selection after failure", async () => {
  const app = await loaded();
  let failRead = false;
  let rejectWrite!: (reason: Error) => void;
  let writes = 0;
  const slot = renderSlot(
    app.navPanels[0],
    { subPath: "" },
    {
      rpc: {
        list: () => {
          if (failRead) throw new Error("Offline");
          return consumer.items;
        },
        review: () => {
          writes++;
          return new Promise((_, no) => {
            rejectWrite = no;
          });
        },
      },
    },
  );
  const row = await slot.findByRole("button", {
    name: consumer.items[0].title,
  });
  row.focus();
  await userEvent.keyboard("{Enter}");
  await slot.findByText(consumer.items[0].detail);
  const save = slot.getByRole("button", { name: "Mark reviewed" });
  await userEvent.click(save);
  expect(
    (slot.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.click(save);
  expect(writes).toBe(1);
  rejectWrite(new Error("Write failed"));
  await slot.findByText(
    "Could not save. Your selection is retained; try again.",
  );
  expect(slot.getByText(consumer.items[0].detail)).toBeTruthy();
  failRead = true;
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await waitFor(() =>
    expect(
      slot.getByText("Could not load items. Check the connection and retry."),
    ).toBeTruthy(),
  );
  expect(
    slot.getByRole("button", { name: consumer.items[0].title }),
  ).toBeTruthy();
  slot.lifecycle.unmount();
});

test("successful mutation acknowledges once and refreshed data shows Reviewed", async () => {
  const app = await loaded();
  let reviewed = false;
  const slot = renderSlot(
    app.navPanels[0],
    { subPath: "" },
    {
      rpc: {
        list: () => consumer.items.map((item) => ({ ...item, reviewed })),
        review: () => {
          reviewed = true;
          return { accepted: true };
        },
      },
    },
  );
  await userEvent.click(
    await slot.findByRole("button", { name: consumer.items[0].title }),
  );
  await userEvent.click(slot.getByRole("button", { name: "Mark reviewed" }));
  // The server invalidates the tag in production; the harness connection driver
  // exercises read reconciliation without pretending to run that server.
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  const reviewedButton = await slot.findByRole("button", {
    name: "Reviewed",
  });
  expect((reviewedButton as HTMLButtonElement).disabled).toBe(true);
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "review"),
  ).toHaveLength(1);
  slot.lifecycle.unmount();
});
