import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { z } from "zod";
import { browseContract, browseInputSchema } from "../lib/browse-contract.ts";
import { readRoute } from "../components/radio/routes.ts";

const project = { id: "proj_one", name: "One", channelId: "channel_main" };
const channel = {
  id: "channel_main",
  projectId: project.id,
  name: "one",
  parentId: null,
};
const tx = {
  id: "tx_one",
  cursor: 1,
  body: "Ready for review.",
  channelId: channel.id,
  authorId: "actor_one",
  sessionId: "thr_one",
  createdAt: "2026-11-10T23:00:00Z",
  replyToId: null,
  replyForId: null,
  requireAck: true,
  expectReply: true,
  requestMode: "discussion",
  refs: [{ kind: "dispatch", id: "dispatch_one", revision: 2 }],
  recipientIds: ["actor_two", "thr_two"],
  audiences: [{ channelId: channel.id, eligibleCount: 2 }],
  tags: [],
};
const doc = {
  id: "dispatch_one",
  channelId: channel.id,
  authorId: "actor_one",
  revision: 2,
  title: "Cutover notes",
  markdown: "# Details\n\n<script>unsafe()</script>",
  editorId: "actor_one",
  createdAt: tx.createdAt,
};
function data(request: z.infer<typeof browseInputSchema>["request"]) {
  switch (request.op) {
    case "channels":
      return { items: [channel], nextCursor: channel.id, hasMore: false };
    case "scan":
      return { items: [tx], nextCursor: 1, hasMore: false };
    case "dispatch-list":
      return {
        items: [{ id: doc.id, cursor: 1, title: doc.title, revision: 2 }],
        nextCursor: 1,
        hasMore: false,
      };
    case "read":
      return tx;
    case "dispatch-read":
      return doc;
    case "response-summary":
      return [
        {
          targetId: "actor_two",
          ackAt: tx.createdAt,
          standbyAt: null,
          squelchAt: null,
          receivedEndpoints: 0,
        },
        {
          targetId: "thr_two",
          ackAt: null,
          standbyAt: tx.createdAt,
          squelchAt: null,
          receivedEndpoints: 1,
        },
      ];
    default:
      throw new Error(`Unexpected read ${request.op}`);
  }
}
async function mount(
  subPath: string,
  handler?: (input: z.infer<typeof browseInputSchema>) => unknown,
  visible = true,
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  expect(app.navPanels).toHaveLength(1);
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    {
      pluginId: "radio",
      tabVisible: visible,
      experimental_rpcContract: browseContract,
      sdk: {
        projects: {
          list: async () => [
            {
              ...project,
              kind: "standard",
              sources: [],
              createdAt: 0,
              updatedAt: 0,
              gitRemoteUrl: null,
            },
          ],
        },
      },
      rpc: {
        browse: async (raw) => {
          const input = browseInputSchema.parse(raw);
          return handler
            ? handler(input)
            : { ok: true, project, data: data(input.request) };
        },
      },
    },
  );
}

describe("Radio additive reader", () => {
  it("works without sidebar/thread context, keeps canonical links and never acts or confirms receipt", async () => {
    const slot = await mount("proj_one/channel/channel_main");
    expect(await slot.findByText(tx.body)).toBeTruthy();
    expect(await slot.findByText(doc.title)).toBeTruthy();
    const link = slot.getByRole("link", { name: tx.body });
    expect(link.getAttribute("href")).toBe(
      "/plugins/radio/radio/proj_one/transmission/tx_one",
    );
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "radio",
      options: { subPath: "proj_one/transmission/tx_one" },
    });
    expect(
      slot.inspection.rpcCalls.every((call) => call.method === "browse"),
    ).toBe(true);
    expect(
      slot.inspection.rpcCalls.some((call) =>
        JSON.stringify(call.input).includes('"respond"'),
      ),
    ).toBe(false);
    expect(
      slot.inspection.sdkCalls.every((call) => call.method === "projects.list"),
    ).toBe(true);
    slot.lifecycle.unmount();
  });
  it("supports keyboard project selection and preserves focus on passive refresh", async () => {
    const slot = await mount("proj_one/channel/channel_main");
    const link = await slot.findByRole("link", { name: tx.body });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(
      slot.getByRole("combobox", { name: "Project" }),
    );
    await user.keyboard("{Enter}");
    expect(await slot.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        slot.getByRole("combobox", { name: "Project" }),
      ),
    );
    link.focus();
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(document.activeElement).toBe(link);
    slot.lifecycle.unmount();
  });
  it("shows receipt unknown independently of ack and of a separately addressed session", async () => {
    const slot = await mount("proj_one/transmission/tx_one");
    expect(
      await slot.findByText(/Receipt unknown · Ack recorded/),
    ).toBeTruthy();
    expect(
      await slot.findByText(
        /Received confirmed at 1 endpoint · No ack recorded/,
      ),
    ).toBeTruthy();
    expect(
      slot
        .getByRole("link", { name: "Dispatch revision 2" })
        .getAttribute("href"),
    ).toBe("/plugins/radio/radio/proj_one/dispatch/dispatch_one/2");
    expect(slot.getByText(/Standby recorded \(no commitment\)/)).toBeTruthy();
    slot.lifecycle.unmount();
  });
  it("delegates dispatch Markdown to the host and keeps latest separate from the pinned revision", async () => {
    const slot = await mount("proj_one/dispatch/dispatch_one/2");
    expect(await slot.findByText(doc.title)).toBeTruthy();
    expect(slot.getByText("Revision 2 · Pinned revision")).toBeTruthy();
    expect(
      slot.getByRole("link", { name: "Read latest" }).getAttribute("href"),
    ).toBe("/plugins/radio/radio/proj_one/dispatch/dispatch_one");
    expect(slot.container.querySelector("script")).toBeNull();
    slot.lifecycle.unmount();
  });
  it("opens canonical record/channel links independently of a failed channel directory", async () => {
    for (const [route, text] of [
      ["proj_one/transmission/tx_one", tx.body],
      ["proj_one/dispatch/dispatch_one/2", doc.title],
      ["proj_one/channel/channel_main", tx.body],
    ]) {
      const slot = await mount(route!, (input) => {
        if (input.request.op === "channels")
          return {
            ok: false,
            error: {
              code: "internal_error",
              message: "Channel directory temporarily unavailable.",
              choices: [],
            },
          };
        return { ok: true, project, data: data(input.request) };
      });
      expect(await slot.findByText(text!)).toBeTruthy();
      expect(await slot.findByRole("alert")).toBeTruthy();
      expect(
        slot.inspection.rpcCalls.some(
          (call) =>
            call.method === "browse" &&
            (call.input as { request: { op: string } }).request.op !==
              "channels",
        ),
      ).toBe(true);
      slot.lifecycle.unmount();
    }
  });
  it("retains loaded history after a domain refresh error and permits an explicit retry", async () => {
    let fail = false;
    const slot = await mount("proj_one/channel/channel_main", (input) => {
      if (input.request.op === "scan" && fail)
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "History temporarily unavailable.",
            choices: [],
          },
        };
      return { ok: true, project, data: data(input.request) };
    });
    expect(await slot.findByText(tx.body)).toBeTruthy();
    fail = true;
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(await slot.findByRole("alert")).toBeTruthy();
    expect(slot.getByText(tx.body)).toBeTruthy();
    fail = false;
    fireEvent.click(slot.getByRole("button", { name: "Retry read" }));
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    slot.lifecycle.unmount();
  });
  it("distinguishes loading failure, empty pages and unselected project without acquiring @user", async () => {
    const none = await mount("");
    expect(
      await none.findByText(/Choose a project to read its channels/),
    ).toBeTruthy();
    expect(none.inspection.rpcCalls).toEqual([]);
    none.lifecycle.unmount();
    const failed = await mount("proj_one", () => {
      throw new Error("Offline");
    });
    expect(await failed.findByRole("alert")).toBeTruthy();
    expect(failed.queryByText("No transmissions on this page.")).toBeNull();
    failed.lifecycle.unmount();
    const empty = await mount("proj_one", (input) => ({
      ok: true,
      project,
      data:
        input.request.op === "channels"
          ? data(input.request)
          : { items: [], nextCursor: 0, hasMore: false },
    }));
    expect(
      await empty.findByText("No transmissions on this page."),
    ).toBeTruthy();
    expect(await empty.findByText("No dispatches on this page.")).toBeTruthy();
    empty.lifecycle.unmount();
  });
  it("pauses hidden reads and rejects malformed deep links", async () => {
    const hidden = await mount("proj_one", undefined, false);
    expect(hidden.inspection.rpcCalls).toEqual([]);
    expect(hidden.inspection.sdkCalls).toEqual([]);
    hidden.lifecycle.unmount();
    const invalid = await mount("proj_one/dispatch/x/not-a-revision");
    expect(invalid.getByRole("alert").textContent).toContain("invalid");
    expect(invalid.inspection.rpcCalls).toEqual([]);
    invalid.lifecycle.unmount();
    expect(readRoute("proj_one/dispatch/d/0")).toBeNull();
    expect(readRoute("proj_one/dispatch/d/9007199254740992")).toBeNull();
    expect(readRoute("proj_%zz")).toBeNull();
  });
});
