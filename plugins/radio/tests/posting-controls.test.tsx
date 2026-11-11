import { useState } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  ActingContext,
  type ActingIdentity,
} from "../components/radio/acting-context.ts";
import { PostingComposer } from "../components/radio/posting-composer.tsx";
import {
  blankFields,
  draftKey,
  readDraft,
  type PostingScope,
} from "../components/radio/posting-draft.ts";
import {
  operationSchema,
  type RadioOperation,
} from "../lib/operation-contracts.ts";
import type { SurfaceResult } from "../lib/surface-contract.ts";
import { identity, project } from "./acting-fixture.ts";

type Send = Extract<RadioOperation, { op: "tx" | "reply" }>;
const scope: PostingScope = {
  identity: identity(),
  projectId: project.id,
  channelId: project.channelId,
};
const accepted = (request: Send, who = scope.identity): SurfaceResult => ({
  ok: true,
  data: {
    state: "sent",
    replayed: false,
    transmission: {
      ...request.input,
      id: "tx_sent",
      cursor: 2,
      authorId: who.actorId,
      sessionId: who.sessionId,
      createdAt: "2026-11-11T04:00:00Z",
      replyToId: request.input.replyToId ?? null,
      replyForId: request.input.replyForId ?? null,
      recipientIds: request.input.recipientIds,
      audiences: [],
      tags: [],
    },
  },
  attention: {
    discovery: { sampleCount: 0, hasMore: false },
    required: { sampleCount: 0, hasMore: false },
    commitments: { sampleCount: 0, hasMore: false },
  },
});
async function mount(
  options: {
    parent?: PostingScope["parent"];
    visible?: boolean;
    handler?: (request: Send, who: ActingIdentity) => Promise<SurfaceResult>;
  } = {},
) {
  const requests: Send[] = [];
  const app = await loadPluginApp(async () => ({
    default: definePluginApp((app) => {
      app.slots.navPanel({
        id: "posting-test",
        path: "posting-test",
        title: "Posting test",
        icon: "Radio",
        component: function TestComposer() {
          const [original, setOriginal] = useState(true);
          const who = original
            ? identity()
            : { ...identity(), actorId: "actor_other", sessionId: "thr_other" };
          return (
            <ActingContext.Provider
              value={{
                projectId: project.id,
                mode: "thread",
                threadId: who.sessionId!,
                identity: who,
                pending: false,
                perform: async (input) => {
                  const request = operationSchema.parse(input);
                  if (request.op !== "tx" && request.op !== "reply")
                    throw new Error("Unexpected operation");
                  requests.push(request);
                  return options.handler
                    ? options.handler(request, who)
                    : accepted(request, who);
                },
              }}
            >
              <button onClick={() => setOriginal((value) => !value)}>
                Switch identity
              </button>
              <PostingComposer
                projectId={project.id}
                channelId={project.channelId}
                parent={options.parent}
              />
            </ActingContext.Provider>
          );
        },
      });
    }),
  }));
  const slot = await renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    { pluginId: "radio", tabVisible: options.visible ?? true },
  );
  return { slot, requests };
}
const edit = (
  slot: Awaited<ReturnType<typeof mount>>["slot"],
  name: string,
  value: string,
) =>
  fireEvent.change(within(slot.container).getByLabelText(name), {
    target: { value },
  });
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Radio posting and reply recovery", () => {
  it("validates Unicode body limits without truncation and sends explicit references/expectations", async () => {
    const { slot, requests } = await mount();
    edit(slot, "Transmission", "🛰️".repeat(201));
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(requests).toEqual([]);
    const body = "😀".repeat(400);
    edit(slot, "Transmission", body);
    fireEvent.click(slot.getByText("References and canonical recipients"));
    edit(
      slot,
      "External references (one HTTP(S) URL per line)",
      "https://example.com/notes",
    );
    edit(slot, "Dispatch reference (canonical ID, optional)", "dispatch_one");
    edit(slot, "Pinned dispatch revision (optional)", "2");
    edit(
      slot,
      "Additional canonical recipient IDs (comma or space separated)",
      "actor_two, actor_two thr_two",
    );
    fireEvent.click(slot.getByLabelText("Request ack"));
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.input).toMatchObject({
      body,
      channelId: project.channelId,
      requireAck: true,
      recipientIds: ["actor_two", "thr_two"],
      refs: [
        { kind: "url", url: "https://example.com/notes" },
        { kind: "dispatch", id: "dispatch_one", revision: 2 },
      ],
    });
    expect(slot.inspection.sdkCalls).toEqual([]);
    slot.lifecycle.unmount();
  });
  it("restores an unknown send after remount without automatic retry, then replays the exact request", async () => {
    const first = await mount({
      handler: async () => {
        throw new Error("lost response");
      },
    });
    edit(first.slot, "Transmission", "@agent-name Check these details.");
    fireEvent.click(
      first.slot.getByRole("button", { name: "Send transmission" }),
    );
    expect(await first.slot.findByRole("alert")).toBeTruthy();
    const request = first.requests[0]!;
    expect(readDraft(scope).request).toEqual(request.input);
    first.slot.lifecycle.unmount();
    const second = await mount();
    expect(second.requests).toEqual([]);
    expect(
      (second.slot.getByLabelText("Transmission") as HTMLTextAreaElement).value,
    ).toBe(request.input.body);
    expect(
      (
        second.slot.getByLabelText("Transmission") as HTMLTextAreaElement
      ).closest("fieldset")!.disabled,
    ).toBe(true);
    expect(
      (
        second.slot.getByRole("button", {
          name: "Edit as new request",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      second.slot.getByRole("button", { name: "Retry original request" }),
    );
    expect(
      await second.slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(second.requests).toEqual([request]);
    second.slot.lifecycle.unmount();
  });
  it("preserves separate drafts across identity changes and restores only the original owner's pending request", async () => {
    const { slot, requests } = await mount({
      handler: async () => {
        throw new Error("lost response");
      },
    });
    edit(slot, "Transmission", "Owned draft");
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Switch identity" }));
    expect(
      (slot.getByLabelText("Transmission") as HTMLTextAreaElement).value,
    ).toBe("");
    edit(slot, "Transmission", "Different owner draft");
    fireEvent.click(slot.getByRole("button", { name: "Switch identity" }));
    expect(
      (slot.getByLabelText("Transmission") as HTMLTextAreaElement).value,
    ).toBe("Owned draft");
    expect(
      slot.getByRole("button", { name: "Retry original request" }),
    ).toBeTruthy();
    expect(requests).toHaveLength(1);
    slot.lifecycle.unmount();
  });
  it("requires one mixed recipient choice for replies and inherits no parent audience", async () => {
    const { slot, requests } = await mount({
      parent: {
        id: "tx_parent",
        recipientIds: ["actor_one", "thr_pick", "actor_other"],
      },
    });
    edit(slot, "Transmission", "Reply with no inherited audience");
    fireEvent.click(slot.getByRole("button", { name: "Send reply" }));
    expect((await slot.findByRole("alert")).textContent).toContain(
      "one original recipient",
    );
    expect(requests).toEqual([]);
    const user = userEvent.setup();
    slot
      .getByRole("combobox", { name: "Original recipient this reply covers" })
      .focus();
    await user.keyboard("{Enter}");
    (
      await slot.findByRole("option", { name: "Acting session · thr_pick" })
    ).focus();
    await user.keyboard("{Enter}");
    fireEvent.click(slot.getByRole("button", { name: "Send reply" }));
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(requests[0]).toMatchObject({
      op: "reply",
      input: {
        replyToId: "tx_parent",
        replyForId: "thr_pick",
        recipientIds: [],
      },
    });
    slot.lifecycle.unmount();
  });
  it("blocks writes when recovery storage fails and keeps the same original key for explicit recovery", async () => {
    const { slot, requests } = await mount();
    edit(slot, "Transmission", "Store before sending");
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(requests).toEqual([]);
    const key = slot.getByText(/Original request key:/).textContent;
    spy.mockRestore();
    fireEvent.click(
      slot.getByRole("button", { name: "Retry original request" }),
    );
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(key).toContain(requests[0]!.input.idempotencyKey);
    slot.lifecycle.unmount();
  });
  it("retains actual acceptance evidence when saving its confirmation fails", async () => {
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    const { slot, requests } = await mount({
      handler: async (request, who) => {
        spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("storage unavailable after acceptance");
        });
        return accepted(request, who);
      },
    });
    edit(slot, "Transmission", "Confirmed before storage failure");
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(slot.getByRole("alert").textContent).toContain("Sent was confirmed");
    expect(requests).toHaveLength(1);
    spy!.mockRestore();
    expect(readDraft(scope).request?.idempotencyKey).toBe(
      requests[0]!.input.idempotencyKey,
    );
    slot.lifecycle.unmount();
  });
  it("blocks corrupted saved requests until history is checked and never treats them as a new send", async () => {
    sessionStorage.setItem(draftKey(scope), "{broken");
    const { slot, requests } = await mount();
    expect(slot.getByRole("alert").textContent).toContain(
      "Saved draft could not be read",
    );
    expect(
      slot.queryByRole("button", { name: "Send transmission" }),
    ).toBeNull();
    expect(
      (
        slot.getByRole("button", {
          name: "Edit as new request",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(slot.getByLabelText(/I checked channel history/));
    fireEvent.click(slot.getByRole("button", { name: "Edit as new request" }));
    expect(
      slot.getByRole("button", { name: "Send transmission" }),
    ).toBeTruthy();
    expect(requests).toEqual([]);
    slot.lifecycle.unmount();
  });
  it("does not let a late response from a closed panel overwrite a newer request", async () => {
    let release!: (result: SurfaceResult) => void;
    const response = new Promise<SurfaceResult>((resolve) => {
      release = resolve;
    });
    const first = await mount({ handler: async () => response });
    edit(first.slot, "Transmission", "First unknown send");
    fireEvent.click(
      first.slot.getByRole("button", { name: "Send transmission" }),
    );
    await waitFor(() => expect(first.requests).toHaveLength(1));
    first.slot.lifecycle.unmount();
    const second = await mount({
      handler: async () => {
        throw new Error("second lost response");
      },
    });
    fireEvent.click(second.slot.getByLabelText(/I checked channel history/));
    fireEvent.click(
      second.slot.getByRole("button", { name: "Edit as new request" }),
    );
    edit(second.slot, "Transmission", "Second unknown send");
    fireEvent.click(
      second.slot.getByRole("button", { name: "Send transmission" }),
    );
    expect(await second.slot.findByRole("alert")).toBeTruthy();
    const latest = readDraft(scope).request;
    await act(async () => {
      release(accepted(first.requests[0]!));
      await response;
    });
    expect(readDraft(scope).request).toEqual(latest);
    expect(latest?.body).toBe("Second unknown send");
    second.slot.lifecycle.unmount();
  });
  it("adopts another open panel's pending request instead of overwriting its recovery key", async () => {
    const first = await mount({
      handler: async () => {
        throw new Error("lost response");
      },
    });
    const second = await mount();
    edit(first.slot, "Transmission", "First panel owns this request");
    fireEvent.click(
      within(first.slot.container).getByRole("button", {
        name: "Send transmission",
      }),
    );
    expect(await within(first.slot.container).findByRole("alert")).toBeTruthy();
    const original = readDraft(scope).request;
    edit(second.slot, "Transmission", "Second panel must not overwrite it");
    expect(
      within(second.slot.container).getByRole("alert").textContent,
    ).toContain("Another panel saved a request");
    expect(readDraft(scope).request).toEqual(original);
    expect(
      (
        within(second.slot.container).getByLabelText(
          "Transmission",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(original!.body);
    expect(second.requests).toEqual([]);
    first.slot.lifecycle.unmount();
    fireEvent.click(
      second.slot.getByRole("button", { name: "Retry original request" }),
    );
    expect(
      await second.slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(second.requests[0]!.input).toEqual(original);
    second.slot.lifecycle.unmount();
  });
  it("does not post from a hidden panel and scopes recovery by station, project, channel and parent", async () => {
    const { slot, requests } = await mount({ visible: false });
    edit(slot, "Transmission", "Hidden draft");
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(requests).toEqual([]);
    expect(
      new Set([
        draftKey(scope),
        draftKey({
          ...scope,
          identity: { ...scope.identity, stationId: "other" },
        }),
        draftKey({ ...scope, projectId: "proj_two" }),
        draftKey({ ...scope, channelId: "channel_two" }),
        draftKey({ ...scope, parent: { id: "tx_parent", recipientIds: [] } }),
      ]).size,
    ).toBe(5);
    expect(readDraft({ ...scope, channelId: "channel_two" }).fields).toEqual(
      blankFields(),
    );
    slot.lifecycle.unmount();
  });
});
