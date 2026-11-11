import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Ownership } from "../lib/ui/contracts.ts";

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

const owner = { botId: "bot_test", name: "Bob", role: "main" as const };
const selection = {
  providerId: "codex",
  model: "gpt-6.1-sol",
  reasoningLevel: "high",
  permissionMode: "accept-edits" as const,
};
const attachment = {
  type: "localFile" as const,
  path: "/tmp/owned-fixture.txt",
  name: "owned-fixture.txt",
};

test("owned composer action only navigates; draft, attachment, selection and native execution stay intact", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const customization = app.composerCustomizations[0]!;
  expect(customization.scopes).toEqual(["thread"]);
  expect(customization.banners).toBeUndefined();
  expect(customization.sendMenu).toBeUndefined();
  const slot = renderSlot(
    customization.actions![0]!,
    {},
    {
      composer: {
        scope: { kind: "thread", threadId: "thr_owned" },
        text: "Keep this draft.",
        attachments: [attachment],
        selection,
        isRunning: true,
      },
      rpc: { ownership: () => ({ thr_owned: owner }) },
    },
  );
  await userEvent.click(
    await slot.findByRole("button", { name: "Bot settings for @Bob" }),
  );
  expect(slot.inspection.navigateCalls).toEqual([
    {
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_test/settings" },
    },
  ]);
  const composer = slot.inspection.composer;
  expect(composer.draft).toEqual({
    text: "Keep this draft.",
    mentions: [],
    attachments: [attachment],
  });
  expect(composer.selection).toEqual(selection);
  expect(composer.selections).toEqual([]);
  expect(composer.submits).toEqual([]);
  expect(composer.inputLockCalls).toEqual([]);
  expect(composer.textEffectCalls).toEqual([]);
  expect(composer.focusCount).toBe(0);
  expect(slot.inspection.sdkCalls).toEqual([]);
  expect(
    slot.inspection.rpcCalls.every((call) => call.method === "ownership"),
  ).toBe(true);
  slot.lifecycle.unmount();
});

test("late ownership cannot leak an action into another thread or a queued/new composer", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  let resolve!: (result: Ownership) => void;
  const slot = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "thr_owned" } },
      rpc: {
        ownership: (input) => {
          const { keys } = input as { keys: string[] };
          return keys.includes("thr_owned")
            ? new Promise<Ownership>((yes) => {
                resolve = yes;
              })
            : Object.fromEntries(keys.map((key) => [key, null]));
        },
      },
    },
  );
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  await slot.behavior.setComposerScope({
    kind: "thread",
    threadId: "thr_foreign",
  });
  await act(async () => resolve({ thr_owned: owner }));
  expect(slot.queryByRole("button")).toBeNull();
  await slot.behavior.setComposerScope({
    kind: "queued-message",
    threadId: "thr_owned",
    queuedMessageId: "queue_test",
  });
  expect(slot.queryByRole("button")).toBeNull();
  await slot.behavior.setComposerScope({
    kind: "new-thread",
    projectId: "proj_test",
  });
  expect(slot.queryByRole("button")).toBeNull();
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.composer.submits).toEqual([]);
  slot.lifecycle.unmount();
});

test("Info and context-card rows use their pane identity, refresh metadata and hide unowned threads", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  for (const registration of [
    app.threadInfoRows[0]!,
    app.threadContextCardRows[0]!,
  ]) {
    let current: typeof owner | null = owner;
    const slot = renderSlot(
      registration,
      {
        threadId: "thr_pane",
        projectId: "proj_pane",
        environment: { id: "env_pane" },
      },
      {
        context: { threadId: "thr_unrelated", projectId: "proj_unrelated" },
        rpc: {
          ownership: (input) => {
            expect(input).toEqual({ keys: ["thr_pane"] });
            return { thr_pane: current };
          },
        },
      },
    );
    const button = await slot.findByRole("button", {
      name: /@Bob/,
    });
    await userEvent.click(button);
    expect(slot.inspection.navigateCalls[0]).toMatchObject({
      method: "toPluginPanel",
      options: { subPath: "bot_test/settings" },
    });
    current = { ...owner, name: "Robert" };
    await slot.behavior.experimental_invalidateRpc(["bots"]);
    await slot.findByRole("button", { name: /@Robert/ });
    current = null;
    await slot.behavior.experimental_invalidateRpc(["bots"]);
    await waitFor(() => expect(slot.queryByRole("button")).toBeNull());
    expect(slot.inspection.sdkCalls).toEqual([]);
    slot.lifecycle.unmount();
  }
});

test("failed ownership reads and hidden documents do not leave active composer controls", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  let fail = false;
  const slot = renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "thr_owned" } },
      rpc: {
        ownership: () => {
          if (fail) throw new Error("Unavailable");
          return { thr_owned: owner };
        },
      },
    },
  );
  await slot.findByRole("button");
  fail = true;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await waitFor(() => expect(slot.queryByRole("button")).toBeNull());
  fail = false;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByRole("button");
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(slot.queryByRole("button")).toBeNull();
  const reads = slot.inspection.rpcCalls.length;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(slot.inspection.rpcCalls).toHaveLength(reads);
  slot.lifecycle.unmount();
});
