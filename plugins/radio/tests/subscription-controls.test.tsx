import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import radio from "../server.ts";
import { resultSchema } from "../lib/surface-contract.ts";
import {
  ActingContext,
  identitySchema,
  type OperationInput,
} from "../components/radio/acting-context.ts";
import { SubscriptionPanel } from "../components/radio/subscription-panel.tsx";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => sessionStorage.clear());
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function fixture(human = false) {
  const projectId = "proj_subscriptions";
  const host = createFakePluginHost({
    pluginId: "radio",
    settings: { operatorCredential: "test-subscription-operator" },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId,
            title: "Subscriptions",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Subscriptions",
          kind: "standard",
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          gitRemoteUrl: null,
        }),
      },
    },
  });
  hosts.push(host);
  radio(host.bb);
  const context = human
    ? {
        projectId,
        asUser: true,
        operatorCredential: "test-subscription-operator",
      }
    : { projectId, threadId: "thr_listener" };
  async function rpc(request: OperationInput) {
    return resultSchema.parse(
      await host.harness.behavior.callRpc("call", { context, request }),
    );
  }
  const result = await rpc({ op: "whoami", input: {} });
  if (!result.ok) throw new Error(result.error.message);
  const who = identitySchema.parse(result.data);
  const channelId = who.project.channelId;
  await rpc({ op: "handle-assign", input: { name: "listener" } });
  const behavior = {
    loseNext: false,
    malformedNext: false,
    failRead: false,
    attempts: [] as OperationInput[],
  };
  const app = await loadPluginApp(async () => ({
    default: definePluginApp((app) => {
      app.slots.navPanel({
        id: "subscriptions-test",
        path: "subscriptions-test",
        title: "Subscriptions",
        icon: "Radio",
        component: () => (
          <ActingContext.Provider
            value={{
              projectId,
              mode: human ? "operator" : "thread",
              threadId: who.sessionId ?? "",
              identity: who,
              pending: false,
              perform: async (request) => {
                behavior.attempts.push(request);
                if (behavior.failRead && request.op === "listening")
                  throw new Error("read unavailable");
                const result = await rpc(request);
                if (behavior.loseNext) {
                  behavior.loseNext = false;
                  throw new Error("Lost after acceptance");
                }
                if (behavior.malformedNext) {
                  behavior.malformedNext = false;
                  return result.ok
                    ? { ...result, data: { state: "wrong" } }
                    : result;
                }
                return result;
              },
            }}
          >
            <SubscriptionPanel channelId={channelId} />
          </ActingContext.Provider>
        ),
      });
    }),
  }));
  const mount = (visible = true) =>
    renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { pluginId: "radio", tabVisible: visible },
    );
  async function snapshot(key: string, direct = false) {
    const result = await rpc({
      op: "tx",
      input: {
        channelId,
        body: `Broadcast ${key} @ch:${who.project.name}`,
        idempotencyKey: key,
        recipientIds: direct ? [who.sessionId!] : [],
        requireAck: true,
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data as {
      transmission: { id: string; recipientIds: string[] };
    };
  }
  return { who, channelId, projectId, host, behavior, rpc, mount, snapshot };
}
async function confirmed(
  slot: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["mount"]>>,
  text: string,
) {
  await waitFor(() =>
    expect(slot.getByRole("status").textContent).toContain(text),
  );
}
describe("Subscription UI with actual backend", () => {
  it("defaults to the exact session, keeps actor listening explicit and freezes broadcast audiences across mute/unlisten", async () => {
    const f = await fixture();
    const slot = await f.mount();
    expect(f.behavior.attempts).toEqual([]);
    expect(
      (slot.getByRole("radio", { name: "Acting session" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    await confirmed(slot, "Listen recorded");
    expect(f.behavior.attempts[0]).toEqual({
      op: "subscribe",
      input: {
        kind: "listen",
        channelId: f.channelId,
        targetId: f.who.sessionId,
      },
    });
    const first = await f.snapshot("first");
    expect(first.transmission.recipientIds).toEqual([f.who.sessionId]);
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(
      await slot.findByText("Listening at last check", { exact: false }),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Mute" }));
    await confirmed(slot, "Mute recorded");
    const muted = await f.snapshot("muted");
    expect(muted.transmission.recipientIds).toEqual([]);
    const direct = await f.snapshot("direct", true);
    expect(direct.transmission.recipientIds).toEqual([f.who.sessionId]);
    fireEvent.click(slot.getByRole("radio", { name: "Actor-wide" }));
    expect(slot.queryByRole("status")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    await confirmed(slot, "Listen recorded");
    const actor = await f.snapshot("actor");
    expect(actor.transmission.recipientIds).toEqual([f.who.actorId]);
    fireEvent.click(slot.getByRole("button", { name: "Unlisten" }));
    await confirmed(slot, "Unlisten recorded");
    const stopped = await f.snapshot("stopped");
    expect(stopped.transmission.recipientIds).toEqual([]);
    const history = await f.rpc({
      op: "read",
      input: { id: first.transmission.id },
    });
    expect(history.ok && history.data).toMatchObject({
      recipientIds: [f.who.sessionId],
    });
    const check = await f.rpc({ op: "check", input: {} });
    expect(check.ok && check.data).toMatchObject({
      required: {
        items: expect.arrayContaining([
          expect.objectContaining({
            txId: first.transmission.id,
            needAck: true,
          }),
        ]),
      },
    });
    const count = f.host.bb.storage
      .database()
      .prepare<[], { count: number }>(
        "SELECT count(*) AS count FROM response_events",
      )
      .get()!.count;
    expect(count).toBe(0);
    expect(sessionStorage.length).toBe(0);
    slot.lifecycle.unmount();
  });
  it("never automatically repeats an accepted lost change; requires a fresh successful inspection and explicit new intent", async () => {
    const f = await fixture();
    const slot = await f.mount();
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(
      (
        slot.getByRole("button", {
          name: "Listen (unmute)",
        }) as HTMLButtonElement
      ).matches(":disabled"),
    ).toBe(true);
    const checkbox = slot.getByRole("checkbox");
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
    await f.rpc({
      op: "subscribe",
      input: { channelId: f.channelId, kind: "mute" },
    });
    f.behavior.failRead = true;
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(await slot.findByText(/could not be checked/)).toBeTruthy();
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
    f.behavior.failRead = false;
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(
      await slot.findByText("Muted at last check", { exact: false }),
    ).toBeTruthy();
    fireEvent.click(checkbox);
    fireEvent.click(slot.getByRole("button", { name: "Allow a new change" }));
    const current = await f.rpc({ op: "listening", input: {} });
    expect(current.ok && current.data).toMatchObject({
      items: [expect.objectContaining({ muted: true })],
    });
    expect(
      f.behavior.attempts.filter((r) => r.op === "subscribe"),
    ).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Unlisten" }));
    await confirmed(slot, "Unlisten recorded");
    expect(
      f.behavior.attempts.filter((r) => r.op === "subscribe"),
    ).toHaveLength(2);
    slot.lifecycle.unmount();
  });
  it("shows bounded pages without inferring a missing channel is unsubscribed", async () => {
    const f = await fixture();
    for (let index = 0; index < 21; index++) {
      const result = await f.rpc({
        op: "channel-create",
        input: { name: `topic-${index}` },
      });
      if (!result.ok) throw new Error(result.error.message);
      const { channel } = result.data as { channel: { id: string } };
      await f.rpc({
        op: "subscribe",
        input: { kind: "listen", channelId: channel.id },
      });
    }
    await f.rpc({
      op: "subscribe",
      input: { kind: "listen", channelId: f.channelId },
    });
    const slot = await f.mount();
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(await slot.findAllByRole("listitem")).toHaveLength(20);
    expect(slot.queryByRole("link", { name: "This channel" })).toBeNull();
    expect(
      slot.getByText(/absent channel on a page does not establish/),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Next page" }));
    expect(
      await slot.findByRole("link", { name: "This channel" }),
    ).toBeTruthy();
    expect(slot.getAllByRole("listitem")).toHaveLength(2);
    expect(f.behavior.attempts).toEqual([
      {
        op: "listening",
        input: { targetId: f.who.sessionId, after: 0, limit: 20 },
      },
      {
        op: "listening",
        input: { targetId: f.who.sessionId, after: 20, limit: 20 },
      },
    ]);
    slot.lifecycle.unmount();
  });
  it("checks the affected channel exactly when an unrelated subscription page follows an accepted lost change", async () => {
    const f = await fixture();
    for (let index = 0; index < 21; index++) {
      const made = await f.rpc({
        op: "channel-create",
        input: { name: `before-${index}` },
      });
      if (!made.ok) throw new Error("Channel failed");
      const { channel } = made.data as { channel: { id: string } };
      await f.rpc({
        op: "subscribe",
        input: { channelId: channel.id, kind: "listen" },
      });
    }
    const slot = await f.mount();
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    await f.rpc({
      op: "subscribe",
      input: { channelId: f.channelId, kind: "mute" },
    });
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(
      await slot.findByText("This channel: Muted at last exact check."),
    ).toBeTruthy();
    expect(slot.getAllByRole("listitem")).toHaveLength(20);
    expect(slot.queryByRole("link", { name: "This channel" })).toBeNull();
    expect(f.behavior.attempts.at(-1)).toEqual({
      op: "listening",
      input: {
        targetId: f.who.sessionId,
        channelId: f.channelId,
        after: 0,
        limit: 1,
      },
    });
    fireEvent.click(slot.getByRole("checkbox"));
    fireEvent.click(slot.getByRole("button", { name: "Allow a new change" }));
    const exact = await f.rpc({
      op: "listening",
      input: { channelId: f.channelId, limit: 1 },
    });
    expect(exact.ok && exact.data).toMatchObject({
      items: [expect.objectContaining({ muted: true })],
      hasMore: false,
    });
    expect(
      f.behavior.attempts.filter((r) => r.op === "subscribe"),
    ).toHaveLength(1);
    slot.lifecycle.unmount();
  });
  it("keeps operator reads explicit and credentials out of watched inputs/storage, and blocks hidden operations", async () => {
    const f = await fixture(true);
    let slot = await f.mount(false);
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    expect(f.behavior.attempts).toEqual([]);
    slot.lifecycle.unmount();
    slot = await f.mount();
    expect(slot.getByRole("radio", { name: "Human" })).toBeTruthy();
    expect(slot.queryByRole("radio", { name: "Acting session" })).toBeNull();
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect subscriptions" }),
    );
    expect(
      await slot.findByText("No subscriptions on this page."),
    ).toBeTruthy();
    f.behavior.malformedNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Listen (unmute)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(
      (
        slot.getByRole("button", {
          name: "Mute",
        }) as HTMLButtonElement
      ).matches(":disabled"),
    ).toBe(true);
    expect(JSON.stringify(f.behavior.attempts)).not.toContain(
      "operatorCredential",
    );
    expect(sessionStorage.length).toBe(0);
    slot.lifecycle.unmount();
  });
});
