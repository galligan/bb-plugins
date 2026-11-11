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
import { openRadioStorage } from "../lib/storage.ts";
import { browseContract } from "../lib/browse-contract.ts";
import { resultSchema } from "../lib/surface-contract.ts";
import {
  ActingContext,
  identitySchema,
  type OperationInput,
  type ActingIdentity,
} from "../components/radio/acting-context.ts";
import { transmissionSchema } from "../components/radio/view-schemas.ts";
import {
  commitmentOutcomeSchema,
  workRecoveryKey,
} from "../components/radio/commitment-result.ts";
import { CommitmentReader } from "../components/radio/commitment-reader.tsx";
import { TransmissionWork } from "../components/radio/transmission-work.tsx";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function fixture(exclusive = false) {
  const projectId = "proj_work";
  const host = createFakePluginHost({
    pluginId: "radio",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, projectId, title: "Work test" }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Work project",
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
  const context = (threadId: string) => ({ projectId, threadId });
  const rpc = async (threadId: string, request: OperationInput) =>
    resultSchema.parse(
      await host.harness.behavior.callRpc("call", {
        context: context(threadId),
        request,
      }),
    );
  const who = async (threadId: string) => {
    const result = await rpc(threadId, { op: "whoami", input: {} });
    if (!result.ok) throw new Error(result.error.message);
    return identitySchema.parse(result.data);
  };
  const author = await who("thr_author");
  const worker = await who("thr_worker");
  const handle = await rpc("thr_worker", {
    op: "handle-assign",
    input: { name: "work-agent", targetId: worker.actorId },
  });
  if (!handle.ok) throw new Error(handle.error.message);
  const store = openRadioStorage(host.bb.storage);
  store.identities.registerThread("thr_other", worker.actorId);
  const other = await who("thr_other");
  const sent = await rpc("thr_author", {
    op: "tx",
    input: {
      body: "Please complete this work",
      channelId: worker.project.channelId,
      idempotencyKey: "work-request",
      requestMode: exclusive ? "exclusive" : "discussion",
      requireAck: true,
      expectReply: true,
      recipientIds: exclusive
        ? [worker.actorId]
        : [worker.actorId, worker.sessionId!],
    },
  });
  if (!sent.ok) throw new Error(sent.error.message);
  const tx = z
    .object({ transmission: transmissionSchema })
    .parse(sent.data).transmission;
  const behavior = {
    loseNext: false,
    attempts: [] as OperationInput[],
    outcomes: [] as z.infer<typeof commitmentOutcomeSchema>[],
  };
  async function mount(
    identity: ActingIdentity = worker,
    commitmentId?: string,
    visible = true,
  ) {
    const app = await loadPluginApp(async () => ({
      default: definePluginApp((app) => {
        app.slots.navPanel({
          id: "work-test",
          title: "Work controls",
          path: "work-test",
          icon: "Radio",
          component: () => (
            <ActingContext.Provider
              value={{
                projectId,
                mode: "thread",
                threadId: identity.sessionId!,
                identity,
                pending: false,
                perform: async (request) => {
                  behavior.attempts.push(request);
                  const result = await rpc(identity.sessionId!, request);
                  if (result.ok && request.op === "commit")
                    behavior.outcomes.push(
                      commitmentOutcomeSchema.parse(result.data),
                    );
                  if (behavior.loseNext) {
                    behavior.loseNext = false;
                    throw new Error("Lost after work acceptance");
                  }
                  return result;
                },
              }}
            >
              {commitmentId ? (
                <CommitmentReader projectId={projectId} id={commitmentId} />
              ) : (
                <TransmissionWork projectId={projectId} tx={tx} />
              )}
            </ActingContext.Provider>
          ),
        });
      }),
    }));
    return renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        pluginId: "radio",
        tabVisible: visible,
        experimental_rpcContract: browseContract,
        rpc: { browse: (raw) => host.harness.behavior.callRpc("browse", raw) },
      },
    );
  }
  const count = (
    table: "commitments" | "commitment_events" | "response_events",
  ) =>
    host.bb.storage
      .database()
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM ${table}`)
      .get()!.count;
  const work = async (
    threadId: string,
    input: Extract<OperationInput, { op: "commit" }>["input"],
  ) => {
    const result = await rpc(threadId, { op: "commit", input });
    if (!result.ok) throw new Error(result.error.message);
    return commitmentOutcomeSchema.parse(result.data);
  };
  return {
    host,
    author,
    worker,
    other,
    tx,
    projectId,
    mount,
    rpc,
    work,
    count,
    behavior,
  };
}
type Slot = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["mount"]>>;
async function choose(slot: Slot, option: string) {
  const user = userEvent.setup();
  within(slot.container)
    .getByRole("combobox", { name: "Accept work for" })
    .focus();
  await user.keyboard("{Enter}");
  (await slot.findByRole("option", { name: option })).focus();
  await user.keyboard("{Enter}");
}
async function recorded(slot: Slot, kind: string) {
  await waitFor(() =>
    expect(within(slot.container).getByRole("status").textContent).toContain(
      `Recorded ${kind}`,
    ),
  );
}

describe("Commitment UI with actual backend", () => {
  it("accepts one explicit mixed target and completes work without covering receipt/ack/reply", async () => {
    const f = await fixture();
    let slot = await f.mount();
    expect(
      (
        slot.getByRole("button", {
          name: "Record wilco (accept work)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await choose(slot, `Actor · ${f.worker.actorId}`);
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    await recorded(slot, "wilco");
    const commitment = f.behavior.outcomes[0]!.commitment;
    expect(commitment.targetId).toBe(f.worker.actorId);
    const link = slot.getAllByRole("link", { name: "Inspect commitment" })[0]!;
    expect(link.getAttribute("href")).toBe(
      `/plugins/radio/radio/${f.projectId}/commitment/${commitment.id}`,
    );
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "radio",
      options: { subPath: `${f.projectId}/commitment/${commitment.id}` },
    });
    slot.lifecycle.unmount();
    slot = await f.mount(f.other, commitment.id);
    expect(await slot.findByLabelText("Completion result")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Completion result"), {
      target: { value: "Delivered verified result" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Mark done" }));
    await recorded(slot, "done");
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(await slot.findByText("Status: done · Generation 0")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Mark done" })).toBeNull();
    const current = await f.rpc("thr_worker", {
      op: "commitment",
      input: { id: commitment.id },
    });
    expect(current.ok && current.data).toMatchObject({
      status: "done",
      result: "Delivered verified result",
      targetId: f.worker.actorId,
    });
    const summary = await f.rpc("thr_worker", {
      op: "response-summary",
      input: { txId: f.tx.id },
    });
    expect(summary.ok && summary.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: f.worker.actorId,
          receivedEndpoints: 0,
          ackAt: null,
        }),
        expect.objectContaining({
          targetId: f.worker.sessionId,
          receivedEndpoints: 0,
          ackAt: null,
        }),
      ]),
    );
    const check = await f.rpc("thr_worker", { op: "check", input: {} });
    expect(check.ok && check.data).toMatchObject({
      required: {
        items: expect.arrayContaining([
          expect.objectContaining({
            targetId: f.worker.actorId,
            needAck: true,
            needReply: true,
          }),
          expect.objectContaining({
            targetId: f.worker.sessionId,
            needAck: true,
            needReply: true,
          }),
        ]),
      },
    });
    expect(f.count("commitments")).toBe(1);
    expect(f.count("response_events")).toBe(0);
    slot.lifecycle.unmount();
  });
  it("keeps an exact-session commitment closed to other owned sessions", async () => {
    const f = await fixture();
    let slot = await f.mount();
    await choose(slot, `Acting session · ${f.worker.sessionId}`);
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    await recorded(slot, "wilco");
    const commitment = f.behavior.outcomes[0]!.commitment;
    slot.lifecycle.unmount();
    slot = await f.mount(f.other, commitment.id);
    expect(
      await slot.findByText(
        /Select the owning actor or exact addressed session/,
      ),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Mark done" })).toBeNull();
    slot.lifecycle.unmount();
    slot = await f.mount(f.worker, commitment.id);
    fireEvent.change(await slot.findByLabelText("Completion result"), {
      target: { value: "Completed by exact session" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Mark done" }));
    await recorded(slot, "done");
    expect(f.behavior.outcomes.at(-1)!.commitment.targetId).toBe(
      f.worker.sessionId,
    );
    slot.lifecycle.unmount();
  });
  it("replays a lost wilco as its original operation while current canonical work stays done", async () => {
    const f = await fixture(true);
    let slot = await f.mount();
    f.behavior.loseNext = true;
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    expect(await slot.findByRole("alert")).toBeTruthy();
    const first = f.behavior.outcomes[0]!.commitment;
    await f.work("thr_worker", {
      kind: "done",
      commitmentId: first.id,
      result: "Finished while response was lost",
      idempotencyKey: "finish",
    });
    slot.lifecycle.unmount();
    slot = await f.mount();
    fireEvent.click(
      slot.getByRole("button", { name: "Retry original work action" }),
    );
    await recorded(slot, "wilco");
    expect(f.behavior.attempts[1]).toEqual(f.behavior.attempts[0]);
    expect(f.behavior.outcomes[1]!.commitment.status).toBe("open");
    expect(f.count("commitments")).toBe(1);
    expect(f.count("commitment_events")).toBe(2);
    const current = await f.rpc("thr_worker", {
      op: "commitment",
      input: { id: first.id },
    });
    expect(current.ok && current.data).toMatchObject({ status: "done" });
    slot.lifecycle.unmount();
    slot = await f.mount(f.worker, first.id);
    expect(await slot.findByText("Status: done · Generation 1")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Mark done" })).toBeNull();
    slot.lifecycle.unmount();
  });
  it("keeps exact done recovery available after the canonical reader becomes closed", async () => {
    const f = await fixture(true);
    const accepted = await f.work("thr_worker", {
      kind: "wilco",
      txId: f.tx.id,
      targetId: f.worker.actorId,
      idempotencyKey: "open-before-lost-done",
    });
    let slot = await f.mount(f.worker, accepted.commitment.id);
    fireEvent.change(await slot.findByLabelText("Completion result"), {
      target: { value: "Completed before result was lost" },
    });
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Mark done" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    const original = f.behavior.attempts[0];
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(await slot.findByText("Status: done · Generation 1")).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Retry original work action" }),
    ).toBeTruthy();
    slot.lifecycle.unmount();
    slot = await f.mount(f.worker, accepted.commitment.id);
    fireEvent.click(
      await slot.findByRole("button", { name: "Retry original work action" }),
    );
    await recorded(slot, "done");
    expect(f.behavior.attempts).toEqual([original, original]);
    expect(f.count("commitments")).toBe(1);
    expect(f.count("commitment_events")).toBe(2);
    expect(f.count("response_events")).toBe(0);
    slot.lifecycle.unmount();
  });
  it("keeps abandoned exclusive work closed until author reopens and never reopens completed work", async () => {
    const f = await fixture(true);
    let slot = await f.mount();
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    await recorded(slot, "wilco");
    const first = f.behavior.outcomes[0]!.commitment;
    slot.lifecycle.unmount();
    slot = await f.mount(f.worker, first.id);
    fireEvent.change(await slot.findByLabelText("Abandonment reason"), {
      target: { value: "Waiting on unavailable input" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Abandon commitment" }));
    await recorded(slot, "abandon");
    slot.lifecycle.unmount();
    slot = await f.mount();
    expect(
      await slot.findByText(/stays closed until its original author reopens/),
    ).toBeTruthy();
    expect(
      (
        slot.getByRole("button", {
          name: "Record wilco (accept work)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      slot.queryByRole("button", {
        name: "Reopen abandoned exclusive request",
      }),
    ).toBeNull();
    slot.lifecycle.unmount();
    slot = await f.mount(f.author);
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Reopen abandoned exclusive request",
      }),
    );
    await recorded(slot, "reopen");
    expect(f.behavior.outcomes.at(-1)!.event.payload.generation).toBe(2);
    expect(f.behavior.outcomes.at(-1)!.commitment.status).toBe("abandoned");
    slot.lifecycle.unmount();
    slot = await f.mount();
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    await recorded(slot, "wilco");
    const second = f.behavior.outcomes.at(-1)!.commitment;
    expect(second.id).not.toBe(first.id);
    expect(second.generation).toBe(2);
    slot.lifecycle.unmount();
    slot = await f.mount(f.worker, second.id);
    fireEvent.change(await slot.findByLabelText("Completion result"), {
      target: { value: "Finished the next generation" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Mark done" }));
    await recorded(slot, "done");
    slot.lifecycle.unmount();
    slot = await f.mount(f.author);
    expect(await slot.findByText(/exclusive request completed/)).toBeTruthy();
    expect(
      slot.queryByRole("button", {
        name: "Reopen abandoned exclusive request",
      }),
    ).toBeNull();
    expect(f.count("response_events")).toBe(0);
    slot.lifecycle.unmount();
  });
  it("requires the latest bounded history page before offering author reopen", async () => {
    const f = await fixture(true);
    let latestId = "";
    for (let index = 0; index < 8; index++) {
      const accepted = await f.work("thr_worker", {
        kind: "wilco",
        txId: f.tx.id,
        targetId: f.worker.actorId,
        idempotencyKey: `accept-${index}`,
      });
      latestId = accepted.commitment.id;
      await f.work("thr_worker", {
        kind: "abandon",
        commitmentId: latestId,
        reason: "Unavailable",
        idempotencyKey: `abandon-${index}`,
      });
      if (index < 7)
        await f.work("thr_author", {
          kind: "reopen",
          txId: f.tx.id,
          expectedCommitmentId: latestId,
          idempotencyKey: `reopen-${index}`,
        });
    }
    const slot = await f.mount(f.author);
    const history = within(slot.getByRole("region", { name: "Work history" }));
    expect(await history.findAllByRole("listitem")).toHaveLength(20);
    expect(
      slot.queryByRole("button", {
        name: "Reopen abandoned exclusive request",
      }),
    ).toBeNull();
    fireEvent.click(history.getByRole("button", { name: "Next page" }));
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Reopen abandoned exclusive request",
      }),
    );
    await recorded(slot, "reopen");
    expect(f.behavior.attempts.at(-1)).toMatchObject({
      op: "commit",
      input: { kind: "reopen", expectedCommitmentId: latestId },
    });
    expect(f.behavior.outcomes.at(-1)!.event.payload.generation).toBe(9);
    slot.lifecycle.unmount();
  });
  it("blocks hidden/pre-storage writes and preserves a newer pending work action against a stale unreadable panel", async () => {
    const f = await fixture(true);
    let slot = await f.mount(f.worker, undefined, false);
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    expect(f.behavior.attempts).toEqual([]);
    slot.lifecycle.unmount();
    slot = await f.mount();
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    fireEvent.click(
      slot.getByRole("button", { name: "Record wilco (accept work)" }),
    );
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(f.behavior.attempts).toEqual([]);
    expect(f.count("commitments")).toBe(0);
    spy.mockRestore();
    slot.lifecycle.unmount();
    const key = workRecoveryKey({
      identity: f.worker,
      projectId: f.projectId,
      txId: f.tx.id,
    });
    sessionStorage.setItem(key, "{broken");
    const stale = await f.mount();
    const current = await f.mount();
    fireEvent.click(
      within(current.container).getByLabelText(/I inspected work history/),
    );
    fireEvent.click(
      within(current.container).getByRole("button", {
        name: "Clear work recovery",
      }),
    );
    f.behavior.loseNext = true;
    fireEvent.click(
      within(current.container).getByRole("button", {
        name: "Record wilco (accept work)",
      }),
    );
    expect(await within(current.container).findByRole("alert")).toBeTruthy();
    const pending = sessionStorage.getItem(key);
    fireEvent.click(
      within(stale.container).getByLabelText(/I inspected work history/),
    );
    fireEvent.click(
      within(stale.container).getByRole("button", {
        name: "Clear work recovery",
      }),
    );
    expect(sessionStorage.getItem(key)).toBe(pending);
    stale.lifecycle.unmount();
    fireEvent.click(
      current.getByRole("button", { name: "Retry original work action" }),
    );
    await recorded(current, "wilco");
    expect(f.behavior.attempts[1]).toEqual(f.behavior.attempts[0]);
    expect(f.count("commitments")).toBe(1);
    expect(f.count("commitment_events")).toBe(1);
    current.lifecycle.unmount();
  });
});
