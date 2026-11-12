// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { recordsFixture, fullNote, noteId } from "./records-fixture.test.ts";

const consent = "Exclude this memory and its known sources from new retrieval";
const availableNote = (() => {
  if (fullNote.availability !== "available")
    throw new Error("Expected available fixture memory");
  return fullNote;
})();
const receipt = {
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Bob",
  id: noteId,
  availability: "suppressed",
};
function visibility(visible: boolean) {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
afterEach(() => {
  cleanup();
  visibility(true);
});
async function open(options: Parameters<typeof recordsFixture>[0] = {}) {
  const { slot } = await recordsFixture(options);
  await userEvent.click(
    await slot.findByRole("button", { name: "Read full memory Keep evidence" }),
  );
  await slot.findByTestId("bb-markdown");
  return slot;
}

test("forgetting requires deliberate confirmation, hides content on its receipt and returns owned keyboard focus without changing draft or attachments", async () => {
  const slot = await open({
    composer: { text: "Keep draft", attachmentCount: 1 },
    rpc: { botMemoryForget: () => receipt },
  });
  expect(
    slot.getByRole("button", { name: "Forget memory" }).matches(":disabled"),
  ).toBe(true);
  expect(
    slot.getByText(/Historical revisions, previous exports and live context/),
  ).toBeTruthy();
  slot.getByRole("checkbox", { name: consent }).focus();
  await userEvent.keyboard(" ");
  slot.getByRole("button", { name: "Forget memory" }).focus();
  await userEvent.keyboard("{Enter}");
  await slot.findByText(/This memory is excluded from new retrieval/);
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  expect(document.activeElement).toBe(
    slot.getByRole("button", { name: "Back to memory list" }),
  );
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botMemoryForget",
    ),
  ).toEqual([
    expect.objectContaining({
      input: {
        threadId: "thr_owned",
        expectedBotId: "bot_test",
        id: noteId,
        expectedRevision: 2,
        confirm: true,
      },
    }),
  ]);
  expect(slot.inspection.composer.text).toBe("Keep draft");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.submits).toHaveLength(0);
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});

test("unknown delivery requires a current read and new confirmation, preserving the displayed revision until that deliberate decision", async () => {
  let fail = true;
  let current = availableNote;
  const slot = await open({
    rpc: {
      botMemory: () => current,
      botMemoryForget: () => {
        if (fail) throw new Error("Unknown delivery");
        return receipt;
      },
    },
  });
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  await userEvent.click(slot.getByRole("button", { name: "Forget memory" }));
  await slot.findByText(/Could not confirm forgetting/);
  expect(
    slot.getByRole("button", { name: "Forget memory" }).matches(":disabled"),
  ).toBe(true);
  current = {
    ...availableNote,
    note: { ...availableNote.note, revision: 3, markdown: "New evidence" },
  };
  await userEvent.click(
    slot.getByRole("button", { name: "Read current memory" }),
  );
  await waitFor(() =>
    expect(slot.getByTestId("bb-markdown").textContent).toBe("New evidence"),
  );
  expect(
    slot.getByRole("checkbox", { name: consent }).getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botMemoryForget",
    ),
  ).toHaveLength(1);
  fail = false;
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  await userEvent.click(slot.getByRole("button", { name: "Forget memory" }));
  await slot.findByText(/This memory is excluded/);
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "botMemoryForget")
      .at(-1)?.input,
  ).toMatchObject({ expectedRevision: 3 });
});

test("an updated note never silently advances an existing consent to its newer revision", async () => {
  let current = availableNote;
  const slot = await open({
    rpc: { botMemory: () => current, botMemoryForget: () => receipt },
  });
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  current = {
    ...availableNote,
    note: {
      ...availableNote.note,
      revision: 3,
      markdown: "Changed while confirming",
    },
  };
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText(/Memory changed since confirmation/);
  expect(
    slot.getByRole("button", { name: "Forget memory" }).matches(":disabled"),
  ).toBe(true);
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "botMemoryForget"),
  ).toBe(false);
});

test("a failed reconciliation read keeps writes blocked and never retries the forget request", async () => {
  let failRead = false;
  const slot = await open({
    rpc: {
      botMemory: () => {
        if (failRead) throw new Error("Offline");
        return fullNote;
      },
      botMemoryForget: () => {
        throw new Error("Unknown write");
      },
    },
  });
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  await userEvent.click(slot.getByRole("button", { name: "Forget memory" }));
  await slot.findByText(/Could not confirm forgetting/);
  failRead = true;
  await userEvent.click(
    slot.getByRole("button", { name: "Read current memory" }),
  );
  await slot.findByText(/Could not read this memory/);
  expect(slot.queryByRole("button", { name: "Forget memory" })).toBeNull();
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botMemoryForget",
    ),
  ).toHaveLength(1);
});

test("a hidden late receipt neither steals host focus nor sends follow-up work", async () => {
  let release!: (value: typeof receipt) => void;
  const slot = await open({
    rpc: {
      botMemoryForget: () =>
        new Promise<typeof receipt>((yes) => {
          release = yes;
        }),
    },
  });
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  await userEvent.click(slot.getByRole("button", { name: "Forget memory" }));
  await slot.findByRole("button", { name: "Forgetting…" });
  const host = document.createElement("button");
  host.textContent = "Host navigation";
  document.body.append(host);
  try {
    visibility(false);
    host.focus();
    await act(async () => release(receipt));
    visibility(true);
    await slot.findByRole("button", { name: "Back to memory list" });
    expect(document.activeElement).toBe(host);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "botMemoryForget",
      ),
    ).toHaveLength(1);
    expect(slot.inspection.navigateCalls).toHaveLength(0);
  } finally {
    host.remove();
  }
});

test("an explicit reconciliation read can prove suppression after a lost receipt without repeating the write", async () => {
  let suppressed = false;
  const slot = await open({
    rpc: {
      botMemory: () => (suppressed ? receipt : fullNote),
      botMemoryForget: () => {
        suppressed = true;
        throw new Error("Receipt lost");
      },
    },
  });
  await userEvent.click(slot.getByRole("checkbox", { name: consent }));
  await userEvent.click(slot.getByRole("button", { name: "Forget memory" }));
  await slot.findByText(/Could not confirm forgetting/);
  await userEvent.click(
    slot.getByRole("button", { name: "Read current memory" }),
  );
  await slot.findByText(/This memory is excluded/);
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  expect(slot.queryByRole("button", { name: "Forget memory" })).toBeNull();
  expect(
    slot.inspection.rpcCalls.filter(
      (call) => call.method === "botMemoryForget",
    ),
  ).toHaveLength(1);
});

test("a mismatched memory response cannot display or authorize forgetting a different record", async () => {
  let mismatch = true;
  const { slot } = await recordsFixture({
    rpc: {
      botMemory: () =>
        mismatch
          ? {
              ...availableNote,
              note: {
                ...availableNote.note,
                id: "mem_00000000-0000-4000-8000-000000000099",
              },
            }
          : fullNote,
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "Read full memory Keep evidence" }),
  );
  await slot.findByText(/Could not read this memory/);
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  expect(slot.queryByRole("checkbox", { name: consent })).toBeNull();
  mismatch = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry memory read" }),
  );
  await slot.findByTestId("bb-markdown");
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "botMemoryForget"),
  ).toBe(false);
});
