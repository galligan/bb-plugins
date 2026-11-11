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
import { openRadioStorage } from "../lib/storage.ts";
import {
  ActingContext,
  identitySchema,
  type OperationInput,
} from "../components/radio/acting-context.ts";
import { IdentitySettings } from "../components/radio/identity-settings.tsx";
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => sessionStorage.clear());
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function fixture() {
  const projectId = "proj_identity";
  const host = createFakePluginHost({
    pluginId: "radio",
    settings: { operatorCredential: "identity-test-operator" },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId,
            title: "Identity test",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Identity",
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
  const thread = { projectId, threadId: "thr_identity" };
  const operator = {
    projectId,
    asUser: true,
    operatorCredential: "identity-test-operator",
  };
  async function rpc(request: OperationInput, human = false) {
    return resultSchema.parse(
      await host.harness.behavior.callRpc("call", {
        context: human ? operator : thread,
        request,
      }),
    );
  }
  const actorResult = await rpc({ op: "whoami", input: {} });
  const humanResult = await rpc({ op: "whoami", input: {} }, true);
  if (!actorResult.ok || !humanResult.ok) throw new Error("Identity failed");
  const worker = identitySchema.parse(actorResult.data);
  const human = identitySchema.parse(humanResult.data);
  const behavior = { loseNext: false, attempts: [] as OperationInput[] };
  async function mount(asHuman = false, visible = true) {
    const identity = asHuman ? human : worker;
    const app = await loadPluginApp(async () => ({
      default: definePluginApp((app) => {
        app.slots.navPanel({
          id: "identity-test",
          path: "identity-test",
          title: "Identity",
          icon: "Radio",
          component: () => (
            <ActingContext.Provider
              value={{
                projectId,
                mode: asHuman ? "operator" : "thread",
                threadId: identity.sessionId ?? "",
                identity,
                pending: false,
                perform: async (request) => {
                  behavior.attempts.push(request);
                  const result = await rpc(request, asHuman);
                  if (behavior.loseNext) {
                    behavior.loseNext = false;
                    throw new Error("Lost after identity update");
                  }
                  return result;
                },
              }}
            >
              <IdentitySettings />
            </ActingContext.Provider>
          ),
        });
      }),
    }));
    const slot = await renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { pluginId: "radio", tabVisible: visible },
    );
    fireEvent.click(slot.getByText("Identity and handles"));
    return slot;
  }
  return {
    host,
    worker,
    human,
    projectId,
    behavior,
    rpc,
    mount,
    store: openRadioStorage(host.bb.storage),
  };
}
type Slot = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["mount"]>>;
async function recorded(slot: Slot, text: string) {
  await waitFor(() =>
    expect(slot.getByRole("status").textContent).toContain(text),
  );
}
describe("Identity settings with actual backend", () => {
  it("repairs hyphens, keeps canonical targets/rename aliases and removes only owned aliases", async () => {
    const f = await fixture();
    const slot = await f.mount();
    expect(f.behavior.attempts).toEqual([]);
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "Agent__--Name" },
    });
    expect(
      slot.getByText(/Will use @agent-name.*automatically repaired/),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Assign handle" }));
    await recorded(slot, "@agent-name");
    expect(f.store.handles.lookup(f.projectId, "agent-name")?.targetId).toBe(
      f.worker.sessionId,
    );
    const sent = await f.rpc({
      op: "tx",
      input: {
        channelId: f.worker.project.channelId,
        body: "@agent-name keep this target",
        idempotencyKey: "before-rename",
      },
    });
    if (!sent.ok) throw new Error("Send failed");
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "New---Name" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Rename (keep alias)" }));
    await recorded(slot, "@new-name");
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    fireEvent.click(
      await slot.findByRole("button", { name: "Remove alias @agent-name" }),
    );
    await recorded(slot, "Alias removal");
    expect(f.store.handles.lookup(f.projectId, "agent-name")).toBeNull();
    expect(
      f.store.handles.primary(f.projectId, f.worker.sessionId!)?.name,
    ).toBe("new-name");
    const tx = f.store.transmissions.get(
      (sent.data as { transmission: { id: string } }).transmission.id,
      { projectIds: [f.projectId], currentProjectId: f.projectId },
    );
    expect(tx.recipientIds).toEqual([f.worker.sessionId]);
    fireEvent.click(slot.getByRole("radio", { name: "Actor-wide" }));
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "durable-agent" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Assign handle" }));
    await recorded(slot, "@durable-agent");
    expect(f.store.handles.primary(f.projectId, f.worker.actorId)?.name).toBe(
      "durable-agent",
    );
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "@user" },
    });
    expect(slot.getByText("user and ch are reserved.")).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Assign handle" }).matches(":disabled"),
    ).toBe(true);
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "a".repeat(65) },
    });
    expect(
      slot.getByRole("button", { name: "Assign handle" }).matches(":disabled"),
    ).toBe(true);
    expect(slot.queryByRole("button", { name: /reclaim/i })).toBeNull();
    expect(slot.queryByLabelText("Human display name")).toBeNull();
    slot.lifecycle.unmount();
  });
  it("requires operator reclaim intent, shows displacement and preserves old transmissions", async () => {
    const f = await fixture();
    await f.rpc({ op: "handle-assign", input: { name: "claimed-name" } });
    const sent = await f.rpc({
      op: "tx",
      input: {
        channelId: f.worker.project.channelId,
        body: "@claimed-name historical target",
        idempotencyKey: "before-reclaim",
      },
    });
    if (!sent.ok) throw new Error("Send failed");
    const slot = await f.mount(true);
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    fireEvent.click(
      await slot.findByRole("button", { name: "Review reclaim @claimed-name" }),
    );
    expect(slot.getByText(/Holder at last check/).textContent).toContain(
      f.worker.sessionId,
    );
    expect(
      slot.getByRole("button", { name: "Reclaim handle" }).matches(":disabled"),
    ).toBe(true);
    fireEvent.click(
      slot.getByLabelText(
        "I intend to change future address ownership for this name.",
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Reclaim handle" }));
    await recorded(slot, "Previous holder");
    expect(slot.getByRole("status").textContent).toContain("@claimed-name-2");
    expect(f.store.handles.lookup(f.projectId, "claimed-name")?.targetId).toBe(
      f.human.actorId,
    );
    expect(
      f.store.handles.primary(f.projectId, f.worker.sessionId!)?.name,
    ).toBe("claimed-name-2");
    const tx = f.store.transmissions.get(
      (sent.data as { transmission: { id: string } }).transmission.id,
      { projectIds: [f.projectId], currentProjectId: f.projectId },
    );
    expect(tx.recipientIds).toEqual([f.worker.sessionId]);
    const count = f.host.bb.storage
      .database()
      .prepare<[], { count: number }>(
        "SELECT count(*) AS count FROM handle_reassignments",
      )
      .get()!.count;
    expect(count).toBe(1);
    expect(sessionStorage.length).toBe(0);
    slot.lifecycle.unmount();
  });
  it("saves station human display name and project personal handle without changing @user", async () => {
    const f = await fixture();
    const slot = await f.mount(true);
    fireEvent.click(
      slot.getByRole("button", { name: "Inspect human profile" }),
    );
    expect(
      await slot.findByText("Display name at last check: User"),
    ).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Human display name"), {
      target: { value: "  Human Name  " },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save display name" }));
    await recorded(slot, "Display name saved");
    expect(f.store.identities.human().metadata.name).toBe("Human Name");
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "Human__Name" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Assign handle" }));
    await recorded(slot, "@human-name");
    const sent = await f.rpc({
      op: "tx",
      input: {
        channelId: f.worker.project.channelId,
        body: "@user @human-name",
        idempotencyKey: "human-aliases",
      },
    });
    expect(sent.ok && sent.data).toMatchObject({
      transmission: { recipientIds: [f.human.actorId] },
    });
    expect(JSON.stringify(f.behavior.attempts)).not.toContain(
      "operatorCredential",
    );
    expect(sessionStorage.length).toBe(0);
    slot.lifecycle.unmount();
  });
  it("retains a rejected name and a lost rename without automatically undoing a later change", async () => {
    const f = await fixture();
    await f.rpc({ op: "handle-assign", input: { name: "session-name" } });
    await f.rpc({
      op: "handle-assign",
      input: { name: "actor-name", targetId: f.worker.actorId },
    });
    const slot = await f.mount();
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "actor-name" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Rename (keep alias)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect((slot.getByLabelText("Handle name") as HTMLInputElement).value).toBe(
      "actor-name",
    );
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    await slot.findByText(/@session-name · Primary/);
    fireEvent.click(
      slot.getByLabelText(
        "I inspected settings and intend to make a new change.",
      ),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Allow a new settings change" }),
    );
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "accepted-name" },
    });
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Rename (keep alias)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    await f.rpc({ op: "handle-rename", input: { name: "newer-name" } });
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    await slot.findByText(/@newer-name · Primary/);
    fireEvent.click(
      slot.getByLabelText(
        "I inspected settings and intend to make a new change.",
      ),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Allow a new settings change" }),
    );
    expect(
      f.store.handles.primary(f.projectId, f.worker.sessionId!)?.name,
    ).toBe("newer-name");
    expect(
      f.behavior.attempts.filter((r) => r.op === "handle-rename"),
    ).toHaveLength(2);
    slot.lifecycle.unmount();
  });
  it("uses an exact affected-name lookup before releasing uncertainty when the current page does not contain that name", async () => {
    const f = await fixture();
    for (let index = 0; index < 21; index++)
      await f.rpc({
        op: index ? "handle-rename" : "handle-assign",
        input: { name: `aaa-${index.toString().padStart(2, "0")}` },
      });
    const slot = await f.mount();
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "zzz-accepted" },
    });
    f.behavior.loseNext = true;
    fireEvent.click(slot.getByRole("button", { name: "Rename (keep alias)" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    await slot.findByText(/Affected name @zzz-accepted/);
    expect(slot.getAllByRole("listitem")).toHaveLength(20);
    expect(slot.queryByText(/@zzz-accepted · Primary/)).toBeNull();
    expect(f.behavior.attempts.at(-1)).toEqual({
      op: "handle-read",
      input: { name: "zzz-accepted" },
    });
    expect(slot.getByText(/Affected name @zzz-accepted/).textContent).toContain(
      f.worker.sessionId,
    );
    fireEvent.click(
      slot.getByLabelText(
        "I inspected settings and intend to make a new change.",
      ),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Allow a new settings change" }),
    );
    expect(
      f.store.handles.primary(f.projectId, f.worker.sessionId!)?.name,
    ).toBe("zzz-accepted");
    slot.lifecycle.unmount();
  });
  it("keeps handle pages bounded and disables hidden reads/writes", async () => {
    const f = await fixture();
    for (let index = 0; index < 21; index++)
      await f.rpc({
        op: index ? "handle-rename" : "handle-assign",
        input: { name: `name-${index.toString().padStart(2, "0")}` },
      });
    let slot = await f.mount(false, false);
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    fireEvent.change(slot.getByLabelText("Handle name"), {
      target: { value: "hidden-change" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Assign handle" }));
    expect(f.behavior.attempts).toEqual([]);
    slot.lifecycle.unmount();
    slot = await f.mount();
    fireEvent.click(slot.getByRole("button", { name: "Inspect handles" }));
    expect(await slot.findAllByRole("listitem")).toHaveLength(20);
    expect(slot.queryByText(/@name-20 · Primary/)).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Next page" }));
    expect(await slot.findByText(/@name-20 · Primary/)).toBeTruthy();
    expect(slot.getAllByRole("listitem")).toHaveLength(1);
    slot.lifecycle.unmount();
  });
});
