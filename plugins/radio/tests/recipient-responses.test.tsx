import { setPageVisible } from "./page-visibility.ts";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import radio from "../server.ts";
import { browseContract } from "../lib/browse-contract.ts";
import { resultSchema } from "../lib/surface-contract.ts";
import {
  ActingContext,
  identitySchema,
  type OperationInput,
} from "../components/radio/acting-context.ts";
import { RecipientResponseControls } from "../components/radio/recipient-responses.tsx";
import { ResponseHistory } from "../components/radio/response-history.tsx";
import { responseRecoveryKey } from "../components/radio/use-response-recovery.ts";
import { transmissionSchema } from "../components/radio/view-schemas.ts";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function fixture(
  options: { human?: boolean; mixed?: boolean; unaddressed?: boolean } = {},
) {
  const projectId = "proj_responses";
  const host = createFakePluginHost({
    pluginId: "radio",
    settings: { operatorCredential: "response-operator-secret" },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId,
            title: "Response test",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Response project",
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
  const threadContext = { projectId, threadId: "thr_recipient" };
  const context = options.human
    ? {
        projectId,
        asUser: true,
        operatorCredential: "response-operator-secret",
      }
    : threadContext;
  const rpc = async (request: OperationInput, selected = context) =>
    resultSchema.parse(
      await host.harness.behavior.callRpc("call", {
        context: selected,
        request,
      }),
    );
  const result = await rpc({ op: "whoami", input: {} });
  if (!result.ok) throw new Error(result.error.message);
  const who = identitySchema.parse(result.data);
  if (!options.human) {
    const handle = await rpc({
      op: "handle-assign",
      input: { targetId: who.actorId, name: "response-agent" },
    });
    if (!handle.ok) throw new Error(handle.error.message);
  }
  const sent = await rpc(
    {
      op: "tx",
      input: {
        body: "Actual transmission content",
        channelId: who.project.channelId,
        idempotencyKey: "parent",
        recipientIds: options.unaddressed
          ? []
          : options.mixed
            ? [who.actorId, who.sessionId!]
            : [who.actorId],
        requireAck: true,
      },
    },
    threadContext,
  );
  if (!sent.ok) throw new Error(sent.error.message);
  const tx = z
    .object({ transmission: transmissionSchema })
    .parse(sent.data).transmission;
  const behavior = { loseNext: false, attempts: [] as OperationInput[] };
  const app = await loadPluginApp(async () => ({
    default: definePluginApp((app) => {
      app.slots.navPanel({
        id: "response-test",
        title: "Responses",
        path: "response-test",
        icon: "Radio",
        component: () => (
          <ActingContext.Provider
            value={{
              projectId,
              mode: options.human ? "operator" : "thread",
              threadId: who.sessionId ?? "",
              identity: who,
              pending: false,
              perform: async (request) => {
                behavior.attempts.push(request);
                const result = await rpc(request);
                if (behavior.loseNext) {
                  behavior.loseNext = false;
                  throw new Error("Response lost after commit");
                }
                return result;
              },
            }}
          >
            <p>{tx.body}</p>
            <RecipientResponseControls
              txId={tx.id}
              recipientIds={tx.recipientIds}
            />
            <ResponseHistory projectId={projectId} txId={tx.id} />
          </ActingContext.Provider>
        ),
      });
    }),
  }));
  const mount = (visible = true) => {
    setPageVisible(visible);
    return renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        pluginId: "radio",
        tabVisible: false,
        experimental_rpcContract: browseContract,
        rpc: { browse: (raw) => host.harness.behavior.callRpc("browse", raw) },
      },
    );
  };
  const count = (
    table: "response_events" | "receipt_confirmations" | "commitments",
  ) =>
    host.bb.storage
      .database()
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM ${table}`)
      .get()!.count;
  return { host, who, tx, projectId, rpc, mount, behavior, count };
}
async function choose(
  slot: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["mount"]>>,
  option: string,
) {
  const user = userEvent.setup();
  within(slot.container)
    .getByRole("combobox", { name: "Response recipient" })
    .focus();
  await user.keyboard("{Enter}");
  (await slot.findByRole("option", { name: option })).focus();
  await user.keyboard("{Enter}");
}

async function recorded(slot: Parameters<typeof choose>[0], kind: string) {
  await waitFor(() =>
    expect(within(slot.container).getByRole("status").textContent).toContain(
      `Recorded ${kind}`,
    ),
  );
}

describe("Explicit recipient responses against actual backend", () => {
  it("records one actor/session fact at a time without receipt or work commitment", async () => {
    const f = await fixture({ mixed: true });
    const slot = await f.mount();
    expect(
      (slot.getByRole("button", { name: "Record ack" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      slot.queryByRole("button", { name: "Confirm my receipt" }),
    ).toBeNull();
    await choose(slot, `Actor · ${f.who.actorId}`);
    fireEvent.click(slot.getByRole("button", { name: "Record ack" }));
    await recorded(slot, "ack");
    await choose(slot, `Acting session · ${f.who.sessionId}`);
    fireEvent.change(slot.getByLabelText("Standby reason (optional)"), {
      target: { value: "Waiting for context" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Record standby" }));
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toContain(
        "Recorded standby",
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Record squelch" }));
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toContain(
        "Recorded squelch",
      ),
    );
    const summary = await f.rpc({
      op: "response-summary",
      input: { txId: f.tx.id },
    });
    expect(summary.ok && summary.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: f.who.actorId,
          ackAt: expect.any(String),
          standbyAt: null,
          receivedEndpoints: 0,
        }),
        expect.objectContaining({
          targetId: f.who.sessionId,
          ackAt: null,
          standbyAt: expect.any(String),
          squelchAt: expect.any(String),
          receivedEndpoints: 0,
        }),
      ]),
    );
    expect(f.count("response_events")).toBe(3);
    expect(f.count("receipt_confirmations")).toBe(0);
    expect(f.count("commitments")).toBe(0);
    slot.lifecycle.unmount();
  });
  it("requires explicit human content confirmation and replays a lost-after-accept receipt without duplication", async () => {
    const f = await fixture({ human: true });
    let slot = await f.mount();
    expect(
      (
        slot.getByRole("button", {
          name: "Confirm my receipt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(f.count("response_events")).toBe(0);
    fireEvent.click(slot.getByLabelText("I received this content as @user"));
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Confirm my receipt" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(f.count("response_events")).toBe(1);
    const original = f.behavior.attempts[0];
    slot.lifecycle.unmount();
    slot = await f.mount();
    expect(f.behavior.attempts).toHaveLength(1);
    fireEvent.click(
      slot.getByRole("button", { name: "Retry original response" }),
    );
    await recorded(slot, "received");
    expect(f.behavior.attempts).toEqual([original, original]);
    expect(f.count("response_events")).toBe(1);
    expect(f.count("receipt_confirmations")).toBe(1);
    expect(f.count("commitments")).toBe(0);
    const saved = sessionStorage.getItem(
      responseRecoveryKey({
        identity: f.who,
        projectId: f.projectId,
        txId: f.tx.id,
      }),
    )!;
    expect(saved).not.toContain("response-operator-secret");
    expect(saved).not.toContain("operatorCredential");
    expect(saved).not.toContain("asUser");
    slot.lifecycle.unmount();
  });
  it("does not record facts from hidden or unaddressed controls", async () => {
    const f = await fixture();
    let slot = await f.mount(false);
    fireEvent.click(slot.getByRole("button", { name: "Record ack" }));
    expect(f.behavior.attempts).toEqual([]);
    slot.lifecycle.unmount();
    const unaddressed = await fixture({ unaddressed: true });
    slot = await unaddressed.mount();
    expect(
      slot.getByText(
        "This acting identity has no addressed recipient on this transmission.",
      ),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Record ack" })).toBeNull();
    expect(unaddressed.behavior.attempts).toEqual([]);
    slot.lifecycle.unmount();
  });
  it("refuses a write before recovery storage succeeds", async () => {
    const f = await fixture();
    const slot = await f.mount();
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    fireEvent.click(slot.getByRole("button", { name: "Record ack" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(f.behavior.attempts).toEqual([]);
    expect(f.count("response_events")).toBe(0);
    spy.mockRestore();
    fireEvent.click(slot.getByRole("button", { name: "Record ack" }));
    await recorded(slot, "ack");
    expect(f.count("response_events")).toBe(1);
    slot.lifecycle.unmount();
  });
  it("adopts a concurrent panel's unknown response and keeps its original key", async () => {
    const f = await fixture();
    const first = await f.mount();
    const second = await f.mount();
    f.behavior.loseNext = true;
    fireEvent.click(
      within(first.container).getByRole("button", { name: "Record ack" }),
    );
    expect(await within(first.container).findByRole("alert")).toBeTruthy();
    fireEvent.click(
      within(second.container).getByRole("button", { name: "Record ack" }),
    );
    expect(within(second.container).getByRole("alert").textContent).toContain(
      "Another panel saved a pending response",
    );
    expect(f.behavior.attempts).toHaveLength(1);
    first.lifecycle.unmount();
    fireEvent.click(
      second.getByRole("button", { name: "Retry original response" }),
    );
    await recorded(second, "ack");
    expect(f.behavior.attempts[1]).toEqual(f.behavior.attempts[0]);
    expect(f.count("response_events")).toBe(1);
    second.lifecycle.unmount();
  });
  it("requires history acknowledgment before clearing a malformed recovery record", async () => {
    const f = await fixture();
    sessionStorage.setItem(
      responseRecoveryKey({
        identity: f.who,
        projectId: f.projectId,
        txId: f.tx.id,
      }),
      "{broken",
    );
    const slot = await f.mount();
    expect(slot.getByRole("alert")).toBeTruthy();
    expect(
      (
        slot.getByRole("button", {
          name: "Clear response recovery",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(slot.getByLabelText(/I inspected response history/));
    fireEvent.click(
      slot.getByRole("button", { name: "Clear response recovery" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Record ack" }));
    await recorded(slot, "ack");
    expect(f.count("response_events")).toBe(1);
    slot.lifecycle.unmount();
  });
  it("does not let a stale unreadable panel erase a newer pending response", async () => {
    const f = await fixture();
    const key = responseRecoveryKey({
      identity: f.who,
      projectId: f.projectId,
      txId: f.tx.id,
    });
    sessionStorage.setItem(key, "{broken");
    const stale = await f.mount();
    const current = await f.mount();
    fireEvent.click(
      within(current.container).getByLabelText(/I inspected response history/),
    );
    fireEvent.click(
      within(current.container).getByRole("button", {
        name: "Clear response recovery",
      }),
    );
    f.behavior.loseNext = true;
    fireEvent.click(
      within(current.container).getByRole("button", { name: "Record ack" }),
    );
    expect(await within(current.container).findByRole("alert")).toBeTruthy();
    const pending = sessionStorage.getItem(key);
    fireEvent.click(
      within(stale.container).getByLabelText(/I inspected response history/),
    );
    fireEvent.click(
      within(stale.container).getByRole("button", {
        name: "Clear response recovery",
      }),
    );
    expect(sessionStorage.getItem(key)).toBe(pending);
    expect(
      within(stale.container).getByRole("button", {
        name: "Retry original response",
      }),
    ).toBeTruthy();
    stale.lifecycle.unmount();
    fireEvent.click(
      current.getByRole("button", { name: "Retry original response" }),
    );
    await recorded(current, "ack");
    expect(f.behavior.attempts[1]).toEqual(f.behavior.attempts[0]);
    expect(f.count("response_events")).toBe(1);
    current.lifecycle.unmount();
  });
  it("paginates real response history without recording receipt or new response facts", async () => {
    const f = await fixture();
    for (let index = 0; index < 25; index++) {
      const result = await f.rpc({
        op: "respond",
        input: {
          kind: "ack",
          targetId: f.who.actorId,
          txId: f.tx.id,
          idempotencyKey: `history-${index}`,
        },
      });
      expect(result.ok).toBe(true);
    }
    const slot = await f.mount();
    const history = within(
      slot.getByRole("region", { name: "Response history" }),
    );
    expect(await history.findAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(history.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(history.getAllByRole("listitem")).toHaveLength(5),
    );
    expect(
      (history.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(f.behavior.attempts).toEqual([]);
    expect(f.count("response_events")).toBe(25);
    expect(f.count("receipt_confirmations")).toBe(0);
    slot.lifecycle.unmount();
  });
});
