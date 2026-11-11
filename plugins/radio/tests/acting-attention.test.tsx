import { describe, it, expect } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { browseContract, browseInputSchema } from "../lib/browse-contract.ts";
import { rpcContract } from "../lib/surface-contract.ts";
import { project, identity, attention } from "./acting-fixture.ts";

export async function mount(
  options: {
    operatorGate?: Promise<void>;
    rejectOperator?: boolean;
    rejectThread?: boolean;
    visible?: boolean;
    threadCount?: number;
    duplicateTitles?: boolean;
  } = {},
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const contract = { ...browseContract, ...rpcContract };
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "proj_one" },
    {
      pluginId: "radio",
      tabVisible: options.visible ?? true,
      experimental_rpcContract: contract,
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
        threads: {
          list: async (args) =>
            Array.from({ length: options.threadCount ?? 1 }, (_, index) => ({
              ...{
                ...makeThreadResponse({
                  id: "thr_pick",
                  projectId: project.id,
                  title: "Picked thread",
                }),
                activity: {
                  activeBackgroundAgentCount: 0,
                  activeBackgroundCommandCount: 0,
                  activePlanModeCount: 0,
                  activeWorkflowCount: 0,
                },
                environmentBranchName: null,
                environmentHostId: null,
                environmentIsWorktree: null,
                environmentName: null,
                environmentPath: null,
                environmentProviderId: null,
                environmentWorkspaceDisplayKind: "other" as const,
                queuedWork: "none" as const,
                runtime: { displayStatus: "idle" as const },
                latestAttentionAt: 0,
                titleFallback: null,
                hasPendingInteraction: false,
                pinSortKey: null,
              },
              id:
                index === 0
                  ? "thr_pick"
                  : index === 1
                    ? "thr_second-name"
                    : `thr_${index}`,
              title: options.duplicateTitles
                ? "Shared title"
                : index === 0
                  ? "Picked thread"
                  : `Thread ${index}`,
            })).slice(
              args?.offset ?? 0,
              (args?.offset ?? 0) + (args?.limit ?? 51),
            ),
        },
      },
      rpc: {
        browse: async (raw) => {
          const { request } = browseInputSchema.parse(raw);
          return {
            ok: true,
            project,
            data:
              request.op === "channels"
                ? {
                    items: [
                      {
                        id: project.channelId,
                        projectId: project.id,
                        name: "one",
                        parentId: null,
                      },
                    ],
                    nextCursor: project.channelId,
                    hasMore: false,
                  }
                : { items: [], nextCursor: 0, hasMore: false },
          };
        },
        call: async (raw) => {
          const { context, request } = rpcContract.call.input.parse(raw);
          if (context.asUser) await options.operatorGate;
          if (
            (context.asUser && options.rejectOperator) ||
            (!context.asUser && options.rejectThread)
          )
            return {
              ok: false,
              error: {
                code: "forbidden",
                message: context.asUser
                  ? "A valid Radio operator credential is required."
                  : "Invoking thread and project must match.",
                choices: [],
              },
            };
          if (request.op !== "whoami" && request.op !== "check")
            throw new Error("Unexpected acting operation");
          return {
            ok: true,
            data:
              request.op === "whoami"
                ? identity(context.asUser, context.threadId)
                : attention(request.input, context.asUser),
            attention: {
              discovery: { sampleCount: 0, hasMore: false },
              required: { sampleCount: 0, hasMore: false },
              commitments: { sampleCount: 0, hasMore: false },
            },
          };
        },
      },
    },
  );
}
export async function choose(
  slot: Awaited<ReturnType<typeof mount>>,
  label: string,
  option: string,
) {
  const user = userEvent.setup();
  slot.getByRole("combobox", { name: label }).focus();
  await user.keyboard("{Enter}");
  const item = await slot.findByRole("option", { name: option });
  item.focus();
  await user.keyboard("{Enter}");
}
export function calls(slot: Awaited<ReturnType<typeof mount>>) {
  return slot.inspection.rpcCalls
    .filter((call) => call.method === "call")
    .map((call) => rpcContract.call.input.parse(call.input));
}

describe("Explicit acting identity and bounded attention", () => {
  it("starts browse-only and uses only the explicitly selected verified thread for watched reads", async () => {
    const slot = await mount();
    expect(calls(slot)).toEqual([]);
    expect(
      slot.inspection.sdkCalls.some((call) => call.method === "threads.list"),
    ).toBe(false);
    await choose(slot, "Act as", "A BB thread");
    await choose(slot, "Acting BB thread", "Picked thread");
    expect(await slot.findByText("Discovery only")).toBeTruthy();
    expect(
      slot.getByRole("region", { name: "Required responses" }).textContent,
    ).toContain("Actor recipient: actor_one");
    expect(
      slot.getByRole("region", { name: "Required responses" }).textContent,
    ).toContain("Another owned session: thr_other");
    expect(
      calls(slot).every(
        (call) =>
          call.context.threadId === "thr_pick" &&
          !call.context.asUser &&
          call.context.operatorCredential === undefined,
      ),
    ).toBe(true);
    expect(
      slot.inspection.sdkCalls.every((call) =>
        ["projects.list", "threads.list"].includes(call.method),
      ),
    ).toBe(true);
    slot.lifecycle.unmount();
  });
  it("bounds the BB thread picker without automatically selecting an actor", async () => {
    const slot = await mount({ threadCount: 51 });
    await choose(slot, "Act as", "A BB thread");
    await waitFor(() =>
      expect(
        (
          slot.getByRole("button", {
            name: "Next threads",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(slot.getByRole("button", { name: "Next threads" }));
    await waitFor(() => {
      const request = slot.inspection.sdkCalls
        .filter((call) => call.method === "threads.list")
        .at(-1)!;
      expect(request.args[0]).toMatchObject({
        projectId: project.id,
        offset: 50,
        limit: 51,
        archived: false,
        includeHidden: false,
      });
    });
    await waitFor(() =>
      expect(
        (
          slot.getByRole("combobox", {
            name: "Acting BB thread",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    const user = userEvent.setup();
    slot.getByRole("combobox", { name: "Acting BB thread" }).focus();
    await user.keyboard("{Enter}");
    expect(await slot.findByRole("option", { name: "Thread 50" })).toBeTruthy();
    expect(slot.queryByRole("option", { name: "Picked thread" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(calls(slot)).toEqual([]);
    slot.lifecycle.unmount();
  });
  it("disambiguates matching thread titles while preserving opaque canonical IDs", async () => {
    const slot = await mount({ threadCount: 2, duplicateTitles: true });
    await choose(slot, "Act as", "A BB thread");
    await choose(slot, "Acting BB thread", "Shared title · thr_second-name");
    expect(await slot.findByText("Discovery only")).toBeTruthy();
    expect(
      calls(slot).every((call) => call.context.threadId === "thr_second-name"),
    ).toBe(true);
    slot.lifecycle.unmount();
  });
  it("paginates discovery, required responses and commitments independently", async () => {
    const slot = await mount();
    await choose(slot, "Act as", "A BB thread");
    await choose(slot, "Acting BB thread", "Picked thread");
    expect(await slot.findByText("Discovery only")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Next discovery" }));
    await waitFor(() => {
      const check = calls(slot)
        .filter((c) => c.request.op === "check")
        .at(-1)!;
      expect(check.request.input).toMatchObject({
        after: 1,
        requiredAfter: { cursor: 0, targetId: "" },
        commitmentAfter: 0,
      });
    });
    fireEvent.click(await slot.findByRole("button", { name: "Next required" }));
    await waitFor(() => {
      const check = calls(slot)
        .filter((c) => c.request.op === "check")
        .at(-1)!;
      expect(check.request.input).toMatchObject({
        after: 1,
        requiredAfter: { cursor: 8, targetId: "thr_other" },
        commitmentAfter: 0,
      });
    });
    fireEvent.click(
      await slot.findByRole("button", { name: "Next commitments" }),
    );
    await waitFor(() => {
      const check = calls(slot)
        .filter((c) => c.request.op === "check")
        .at(-1)!;
      expect(check.request.input).toMatchObject({
        after: 1,
        requiredAfter: { cursor: 8, targetId: "thr_other" },
        commitmentAfter: 4,
      });
    });
    expect(await slot.findAllByText(/^\d+ on this page/)).toHaveLength(3);
    slot.lifecycle.unmount();
  });
  it("unlocks @user explicitly, keeps its credential out of watched reads and locks without a human fallback", async () => {
    const slot = await mount();
    await choose(slot, "Act as", "@user (operator)");
    const user = userEvent.setup();
    await user.type(
      slot.getByLabelText("Operator credential"),
      "operator-test-secret",
    );
    fireEvent.click(slot.getByRole("button", { name: "Unlock @user" }));
    expect(
      await slot.findByRole("button", { name: "Check attention" }),
    ).toBeTruthy();
    expect(calls(slot)).toHaveLength(1);
    expect(calls(slot)[0]!.context).toMatchObject({
      asUser: true,
      projectId: project.id,
      operatorCredential: "operator-test-secret",
    });
    expect(slot.container.textContent).not.toContain("operator-test-secret");
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(calls(slot)).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Check attention" }));
    expect(await slot.findByText("Discovery only")).toBeTruthy();
    expect(calls(slot)).toHaveLength(2);
    expect(calls(slot)[1]!.request.op).toBe("check");
    fireEvent.click(
      await slot.findByRole("button", { name: "Next discovery" }),
    );
    await waitFor(() => {
      expect(calls(slot)).toHaveLength(3);
      expect(calls(slot)[2]!.request.input).toMatchObject({
        after: 1,
        requiredAfter: { cursor: 0, targetId: "" },
        commitmentAfter: 0,
      });
    });
    await slot.behavior.experimental_invalidateRpc(["radio"]);
    expect(calls(slot)).toHaveLength(3);

    expect(
      slot.inspection.sdkCalls.some((call) =>
        call.method.startsWith("threads."),
      ),
    ).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Lock operator" }));
    await waitFor(() =>
      expect(
        slot.queryByRole("button", { name: "Check attention" }),
      ).toBeNull(),
    );
    expect(
      slot.getByRole("combobox", { name: "Act as" }).textContent,
    ).toContain("Browse only");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    slot.lifecycle.unmount();
  });
  it("explicit lock wins over a late operator-unlock response", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slot = await mount({ operatorGate: gate });
    await choose(slot, "Act as", "@user (operator)");
    fireEvent.change(slot.getByLabelText("Operator credential"), {
      target: { value: "operator-test-secret" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Unlock @user" }));
    await waitFor(() => expect(calls(slot)).toHaveLength(1));
    fireEvent.click(slot.getByRole("button", { name: "Lock operator" }));
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() =>
      expect(
        slot.getByRole("combobox", { name: "Act as" }).textContent,
      ).toContain("Browse only"),
    );
    expect(slot.queryByRole("button", { name: "Check attention" })).toBeNull();
    expect(slot.container.textContent).not.toContain("Posting as @user");
    slot.lifecycle.unmount();
  });
  it("rejects failed operator/thread attribution without choosing another actor", async () => {
    const operator = await mount({ rejectOperator: true });
    await choose(operator, "Act as", "@user (operator)");
    fireEvent.change(operator.getByLabelText("Operator credential"), {
      target: { value: "operator-test-secret" },
    });
    fireEvent.click(operator.getByRole("button", { name: "Unlock @user" }));
    expect(await operator.findByRole("alert")).toBeTruthy();
    expect(
      (operator.getByLabelText("Operator credential") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      operator.queryByRole("button", { name: "Check attention" }),
    ).toBeNull();
    operator.lifecycle.unmount();
    const thread = await mount({ rejectThread: true });
    await choose(thread, "Act as", "A BB thread");
    await choose(thread, "Acting BB thread", "Picked thread");
    expect(await thread.findByRole("alert")).toBeTruthy();
    expect(thread.queryByText("Discovery only")).toBeNull();
    expect(calls(thread).every((call) => !call.context.asUser)).toBe(true);
    thread.lifecycle.unmount();
  });
  it("does not unlock operator mode while its host panel is hidden", async () => {
    const slot = await mount({ visible: false });
    await choose(slot, "Act as", "@user (operator)");
    await waitFor(() =>
      expect(
        slot.getByRole("combobox", { name: "Act as" }).textContent,
      ).toContain("Browse only"),
    );
    expect(calls(slot)).toEqual([]);
    expect(slot.inspection.sdkCalls).toEqual([]);
    slot.lifecycle.unmount();
  });
});
