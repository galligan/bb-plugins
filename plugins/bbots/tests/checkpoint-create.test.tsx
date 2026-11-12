// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { recordsFixture } from "./records-fixture.test.ts";
import { checkpointRequest } from "../lib/ui/checkpoint-contracts.ts";
import { checkpointRequestKey } from "../components/records/checkpoint-request.ts";

const key = checkpointRequestKey("bot_test");
function receipt(input: unknown) {
  const value = checkpointRequest.parse(input);
  return {
    replay: false,
    checkpoint: {
      id: `chk_${value.requestId}`,
      botId: value.expectedBotId,
      name: value.name,
      reason: value.reason,
      author: "user:bot-records",
      createdAt: "2026-11-11T20:00:00.000Z",
    },
  };
}
function visibility(visible: boolean) {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  visibility(true);
});
async function fill(
  slot: Awaited<ReturnType<typeof recordsFixture>>["slot"],
  name = "Before edits",
) {
  const scoped = within(slot.container);
  await scoped.findByText("A bounded excerpt.");
  await userEvent.type(
    scoped.getByRole("textbox", { name: "Checkpoint name" }),
    name,
  );
  await userEvent.type(
    scoped.getByRole("textbox", { name: "Checkpoint reason" }),
    "Explicit save before changes",
  );
}

test("the native form retains its exact identity before one local write, acknowledges its receipt and preserves the composer", async () => {
  const { slot } = await recordsFixture({
    composer: { text: "Keep my draft", attachmentCount: 1 },
    rpc: {
      botCheckpointCreate: (input) => {
        expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(input);
        return receipt(input);
      },
    },
  });
  await fill(slot);
  slot.getByRole("button", { name: "Create checkpoint" }).focus();
  await userEvent.keyboard("{Enter}");
  await slot.findByText(/Checkpoint saved/);
  expect(sessionStorage.getItem(key)).toBeNull();
  const calls = slot.inspection.rpcCalls.filter(
    (call) => call.method === "botCheckpointCreate",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toMatchObject({
    threadId: "thr_owned",
    expectedBotId: "bot_test",
    name: "Before edits",
    reason: "Explicit save before changes",
  });
  expect(slot.inspection.composer.text).toBe("Keep my draft");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.submits).toHaveLength(0);
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});

test("unconfirmed delivery survives remount without a retry; explicit recovery sends the identical retained request", async () => {
  let first: unknown;
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpointCreate: (input) => {
        first = input;
        throw new Error("Receipt lost after write");
      },
    },
  });
  await fill(slot);
  await userEvent.click(
    slot.getByRole("button", { name: "Create checkpoint" }),
  );
  await slot.findByText(/Checkpoint delivery is unconfirmed/);
  expect(
    (slot.getByRole("textbox", { name: "Checkpoint name" }) as HTMLInputElement)
      .value,
  ).toBe("Before edits");
  expect(slot.queryByRole("button", { name: "Create checkpoint" })).toBeNull();
  cleanup();
  const { slot: next } = await recordsFixture({
    rpc: {
      botCheckpointCreate: (input) => {
        expect(input).toEqual(first);
        return { ...receipt(input), replay: true };
      },
    },
  });
  await next.findByText("A bounded excerpt.");
  expect(
    next.inspection.rpcCalls.filter(
      (call) => call.method === "botCheckpointCreate",
    ),
  ).toHaveLength(0);
  await userEvent.click(
    next.getByRole("button", { name: "Recover checkpoint" }),
  );
  await next.findByText(/Checkpoint saved/);
  expect(sessionStorage.getItem(key)).toBeNull();
});

test("one split's pending request prevents another from overwriting it and a hidden completion reconciles the remounted view without sending", async () => {
  let release!: (value: ReturnType<typeof receipt>) => void;
  let submitted: unknown;
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpointCreate: (input) => {
        submitted = input;
        return new Promise<ReturnType<typeof receipt>>((yes) => {
          release = yes;
        });
      },
    },
  });
  const { slot: other } = await recordsFixture();
  const one = within(slot.container),
    two = within(other.container);
  await fill(slot);
  await fill(other, "Other draft");
  await userEvent.dblClick(
    one.getByRole("button", { name: "Create checkpoint" }),
  );
  await two.findByRole("button", { name: "Recover checkpoint" });
  expect(two.queryByRole("button", { name: "Create checkpoint" })).toBeNull();
  expect(
    (
      two.getByRole("textbox", {
        name: "Checkpoint name",
      }) as HTMLInputElement
    ).value,
  ).toBe("Before edits");
  visibility(false);
  visibility(true);
  await one.findByRole("button", { name: "Recover checkpoint" });
  await act(async () => release(receipt(submitted)));
  await one.findByRole("button", { name: "Create checkpoint" });
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botCheckpointCreate",
    ),
  ).toHaveLength(1);
  expect(
    other.inspection.rpcCalls.filter(
      (call) => call.method === "botCheckpointCreate",
    ),
  ).toHaveLength(0);
});

test("a changed retained payload is preserved after a receipt and cannot be blindly recovered or cleared", async () => {
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpointCreate: (input) => {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            ...checkpointRequest.parse(input),
            name: "Changed retained intent",
          }),
        );
        return receipt(input);
      },
    },
  });
  await fill(slot);
  await userEvent.click(
    slot.getByRole("button", { name: "Create checkpoint" }),
  );
  await slot.findByText(/Checkpoint delivery is unconfirmed/);
  expect(slot.queryByText(/Checkpoint saved/)).toBeNull();
  await userEvent.click(
    slot.getByRole("button", { name: "Recover checkpoint" }),
  );
  await slot.findByText(/Could not safely retain or verify/);
  expect(JSON.parse(sessionStorage.getItem(key)!).name).toBe(
    "Changed retained intent",
  );
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botCheckpointCreate",
    ),
  ).toHaveLength(1);
});

test("an unavailable intent store prevents any send and retains the unsent draft", async () => {
  const { slot } = await recordsFixture();
  await fill(slot);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage denied");
  });
  await userEvent.click(
    slot.getByRole("button", { name: "Create checkpoint" }),
  );
  await slot.findByText(/Could not safely retain or verify/);
  expect(
    (slot.getByRole("textbox", { name: "Checkpoint name" }) as HTMLInputElement)
      .value,
  ).toBe("Before edits");
  expect(
    slot.inspection.rpcCalls.some(
      (call) => call.method === "botCheckpointCreate",
    ),
  ).toBe(false);
});

test.each([
  "{broken-json",
  JSON.stringify({
    threadId: "thr_owned",
    expectedBotId: "bot_other",
    requestId: "00000000-0000-4000-8000-000000000001",
    name: "Wrong bot",
    reason: "Do not adopt",
  }),
])(
  "malformed or wrong-bot retained intent is never adopted, overwritten or replayed: %s",
  async (raw) => {
    sessionStorage.setItem(key, raw);
    const { slot } = await recordsFixture();
    await slot.findByText(/Could not safely retain or verify/);
    expect(sessionStorage.getItem(key)).toBe(raw);
    expect(
      slot
        .getByRole("button", { name: "Create checkpoint" })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      slot.inspection.rpcCalls.some(
        (call) => call.method === "botCheckpointCreate",
      ),
    ).toBe(false);
  },
);

test("unsubmitted fields survive backgrounding and a current-record error disables creation", async () => {
  let fail = false;
  const { recordIndex } = await import("./records-fixture.test.ts");
  const { slot } = await recordsFixture({
    rpc: {
      botRecords: () => {
        if (fail) throw new Error("Offline");
        return recordIndex;
      },
    },
  });
  await fill(slot);
  visibility(false);
  visibility(true);
  expect(
    (
      (await slot.findByRole("textbox", {
        name: "Checkpoint name",
      })) as HTMLInputElement
    ).value,
  ).toBe("Before edits");
  fail = true;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText(/Could not read current records/);
  await waitFor(() =>
    expect(
      slot
        .getByRole("button", { name: "Create checkpoint" })
        .matches(":disabled"),
    ).toBe(true),
  );
});
