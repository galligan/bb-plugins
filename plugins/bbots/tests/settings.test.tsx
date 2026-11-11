// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  settingsFixture,
  savedSoul,
  savedDefaults,
} from "./settings-fixture.test.ts";
import { view } from "./fixture.ts";
import { managementContract } from "../lib/setup/contracts.ts";
import { defaultsWriteSchema, soulWriteSchema } from "../lib/soul/contracts.ts";

afterEach(cleanup);

test("a refreshed or truncated bot list does not replace the selected bot or discard an edited SOUL", async () => {
  let bots = [view.bot];
  const { slot } = await settingsFixture({
    list: () => ({ bots, hasMore: true }),
  });
  const editor = await slot.findByRole("textbox", { name: "SOUL.md" });
  await userEvent.type(editor, " Keep this unsaved draft.");
  bots = [{ ...view.bot, id: "bot_other", name: "Other collaborator" }];
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await waitFor(() =>
    expect(
      (slot.getByRole("textbox", { name: "SOUL.md" }) as HTMLTextAreaElement)
        .value,
    ).toContain("Keep this unsaved draft."),
  );
  expect(slot.getByRole("textbox", { name: "SOUL.md" })).toBe(editor);
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "soulUpdate"),
  ).toHaveLength(0);
});

test("the actual settings slot exposes per-bot configuration and no invented global or active automation controls", async () => {
  const { slot } = await settingsFixture();
  await slot.findByRole("textbox", { name: "Name" });
  expect(slot.getByRole("combobox", { name: "Bot" })).toBeTruthy();
  expect(
    slot.getByRole("heading", { name: "Execution defaults" }),
  ).toBeTruthy();
  expect(slot.getByRole("heading", { name: "SOUL.md" })).toBeTruthy();
  expect(slot.queryByRole("switch")).toBeNull();
  expect(await slot.findByText(/Applied revision unknown/)).toBeTruthy();
  expect(
    slot.getByText(
      /Existing conversations keep their native current-thread controls/,
    ),
  ).toBeTruthy();
  expect(
    slot.inspection.rpcCalls.filter((call) =>
      /Update|rename|create|resume/.test(call.method),
    ),
  ).toHaveLength(0);
});

test("name settings save the deliberate revision once without creating or resuming conversations", async () => {
  let current = view;
  const writes: unknown[] = [];
  const { slot } = await settingsFixture({
    show: () => current,
    rename: (input) => {
      const value = managementContract.rename.input.parse(input);
      writes.push(value);
      current = {
        ...view,
        bot: { ...view.bot, name: value.name, revision: 2 },
      };
      return current;
    },
  });
  const name = await slot.findByRole("textbox", { name: "Name" });
  await userEvent.clear(name);
  await userEvent.type(name, "Robert");
  await userEvent.click(slot.getByRole("button", { name: "Save name" }));
  await slot.findByText("Name saved.");
  expect(writes).toEqual([
    { botId: "bot_test", expectedRevision: 1, name: "Robert" },
  ]);
  expect(
    slot.inspection.sdkCalls.filter((call) =>
      call.method.startsWith("threads."),
    ),
  ).toHaveLength(0);
});

test("SOUL saves preserve current versus applied semantics and leave the user's draft intact on a stale revision refusal", async () => {
  let current = savedSoul;
  const writes: unknown[] = [];
  let stale = true;
  const { slot } = await settingsFixture({
    soulShow: () => current,
    soulUpdate: (input) => {
      const value = soulWriteSchema.parse(input);
      writes.push(value);
      if (stale) throw new Error("Revision conflict");
      current = {
        ...current,
        current: {
          ...savedSoul.current!,
          markdown: value.markdown,
          revision: 2,
        },
      };
      return current;
    },
  });
  const editor = await slot.findByRole("textbox", { name: "SOUL.md" });
  await userEvent.clear(editor);
  await userEvent.type(editor, "Be candid and retain evidence.");
  await userEvent.click(slot.getByRole("button", { name: "Save SOUL" }));
  await slot.findByText(/Could not confirm the SOUL save/);
  expect((editor as HTMLTextAreaElement).value).toBe(
    "Be candid and retain evidence.",
  );
  expect(writes).toHaveLength(1);
  expect(slot.getByText(/Applied revision unknown/)).toBeTruthy();
  stale = false;
  await userEvent.click(slot.getByRole("button", { name: "Save SOUL" }));
  await slot.findByText("SOUL saved.");
  expect(writes[1]).toMatchObject({
    botId: "bot_test",
    expectedRevision: 1,
    author: "user:bot-settings",
    reason: "Explicit SOUL save in bot settings",
  });
  expect(
    slot.inspection.sdkCalls.filter((call) =>
      call.method.startsWith("threads."),
    ),
  ).toHaveLength(0);
});

test("future default resets preserve stored fallback intent without enabling it or changing existing threads", async () => {
  const writes: ReturnType<typeof defaultsWriteSchema.parse>[] = [];
  const { slot } = await settingsFixture({
    defaultsUpdate: (input) => {
      const value = defaultsWriteSchema.parse(input);
      writes.push(value);
      return {
        ...savedDefaults,
        defaults: value.defaults,
        effectiveWorker: value.defaults.main,
        revision: 2,
      };
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "Use BB defaults" }),
  );
  await userEvent.click(slot.getByRole("button", { name: "Save defaults" }));
  await slot.findByText("Future conversation defaults saved.");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    botId: "bot_test",
    expectedRevision: 1,
    defaults: {
      main: {},
      worker: null,
      fallback: savedDefaults.defaults.fallback,
    },
  });
  expect(slot.getByText(/Automatic fallback is disabled/)).toBeTruthy();
  expect(
    slot.inspection.sdkCalls.filter((call) =>
      call.method.startsWith("threads."),
    ),
  ).toHaveLength(0);
});

test("editing saved main defaults resolves native pickers on the home host and saves only an explicit coherent selection", async () => {
  const writes: ReturnType<typeof defaultsWriteSchema.parse>[] = [];
  const { slot } = await settingsFixture({
    defaultsUpdate: (input) => {
      const value = defaultsWriteSchema.parse(input);
      writes.push(value);
      return {
        ...savedDefaults,
        defaults: value.defaults,
        effectiveWorker: value.defaults.main,
        revision: 2,
      };
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "Change main defaults" }),
  );
  const picker = await slot.findByTestId("bb-provider-model-picker");
  expect(picker.getAttribute("data-routing-id")).toBe("host_test");
  expect(writes).toHaveLength(0);
  expect(
    (slot.getByRole("button", { name: "Save defaults" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.selectOptions(slot.getByLabelText("Service tier"), "fast");
  await userEvent.click(
    slot.getByRole("button", { name: "Apply execution selection" }),
  );
  await userEvent.click(slot.getByRole("button", { name: "Save defaults" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.defaults.main).toMatchObject({
    providerId: "codex",
    model: "gpt-6.1-sol",
    reasoningLevel: "high",
    permissionMode: "accept-edits",
    serviceTier: "fast",
  });
  expect(writes[0]?.defaults.fallback).toEqual(savedDefaults.defaults.fallback);
});

test("settings and creation are distinct entity routes rather than a stacked bot list", async () => {
  const { slot } = await settingsFixture({}, "bot_test/settings");
  await slot.findByRole("textbox", { name: "Name" });
  expect(slot.queryByRole("button", { name: "Open Bob" })).toBeNull();
  expect(slot.queryByRole("form", { name: "Create a bot" })).toBeNull();
});
