// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  recordsFixture,
  recordIndex,
  noteId,
  checkpointId,
  fullNote,
} from "./records-fixture.test.ts";
import { recordsContract } from "../lib/ui/records-contracts.ts";

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

test("the native tab reads bounded memory/checkpoint entries and a selected full note through the public Markdown renderer", async () => {
  const { slot } = await recordsFixture();
  await slot.findByText("A bounded excerpt.");
  expect(slot.getByText("Before edits")).toBeTruthy();
  expect(slot.getByText(/Revision 2 · Inference/)).toBeTruthy();
  slot.getByRole("button", { name: "Read full memory Keep evidence" }).focus();
  await userEvent.keyboard("{Enter}");
  const markdown = await slot.findByTestId("bb-markdown");
  expect(document.activeElement).toBe(
    slot.getByRole("button", { name: "Back to memory list" }),
  );
  expect(markdown.textContent).toBe(
    "# Full evidence\n\nA retained note body beyond the excerpt.",
  );
  expect(slot.inspection.rpcCalls).toContainEqual(
    expect.objectContaining({
      method: "botMemory",
      input: { threadId: "thr_owned", id: noteId },
    }),
  );
  await userEvent.click(slot.getByText("Evidence sources (1)"));
  expect(slot.getByText("thread:source#msg=1")).toBeTruthy();
  expect(
    slot.getByText(
      /Relative file links use this conversation's native context/,
    ),
  ).toBeTruthy();
  slot.getByRole("button", { name: "Back to memory list" }).focus();
  await userEvent.keyboard("{Enter}");
  await slot.findByText("A bounded excerpt.");
  expect(document.activeElement).toBe(slot.getByRole("searchbox"));
  expect(slot.inspection.sdkCalls).toHaveLength(0);
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  expect(
    slot.inspection.rpcCalls.some((call) =>
      /create|update|restore|forget|send|resume/i.test(call.method),
    ),
  ).toBe(false);
});

test("returning from a hidden selected memory does not take focus from the host", async () => {
  const { slot } = await recordsFixture();
  await userEvent.click(
    await slot.findByRole("button", { name: "Read full memory Keep evidence" }),
  );
  await slot.findByTestId("bb-markdown");
  visibility(false);
  const hostButton = document.createElement("button");
  hostButton.textContent = "Host navigation";
  document.body.append(hostButton);
  try {
    hostButton.focus();
    visibility(true);
    await slot.findByRole("button", { name: "Back to memory list" });
    expect(document.activeElement).toBe(hostButton);
  } finally {
    hostButton.remove();
  }
});

test("search typing retains focus/draft without making a request until explicit search, and no-match is distinct from empty", async () => {
  const { slot } = await recordsFixture({
    rpc: {
      botRecords: (input) => {
        const value = recordsContract.botRecords.input.parse(input);
        return value.query
          ? { ...recordIndex, memory: { items: [], nextCursor: null } }
          : recordIndex;
      },
    },
  });
  const search = await slot.findByRole("searchbox", { name: "Search memory" });
  const before = slot.inspection.rpcCalls.length;
  await userEvent.type(search, "literal %_ search");
  expect(slot.inspection.rpcCalls).toHaveLength(before);
  expect(document.activeElement).toBe(search);
  await userEvent.click(slot.getByRole("button", { name: "Search memory" }));
  await slot.findByText("No records match this search.");
  expect((slot.getByRole("searchbox") as HTMLInputElement).value).toBe(
    "literal %_ search",
  );
  expect(slot.getByRole("searchbox")).toBe(search);
  expect(slot.inspection.rpcCalls).toContainEqual(
    expect.objectContaining({
      method: "botRecords",
      input: {
        threadId: "thr_owned",
        kind: "knowledge",
        query: "literal %_ search",
      },
    }),
  );
  expect(
    slot.queryByText("No retrievable records of this kind yet."),
  ).toBeNull();
});

test("memory and checkpoint cursors stay independent and kind changes reset only memory paging", async () => {
  const inputs: ReturnType<typeof recordsContract.botRecords.input.parse>[] =
    [];
  const { slot } = await recordsFixture({
    rpc: {
      botRecords: (input) => {
        const value = recordsContract.botRecords.input.parse(input);
        inputs.push(value);
        return {
          ...recordIndex,
          memory: {
            ...recordIndex.memory,
            nextCursor: value.memoryAfter ? null : noteId,
          },
          checkpoints: {
            ...recordIndex.checkpoints,
            nextCursor: value.checkpointAfter ? null : checkpointId,
          },
        };
      },
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "More memories" }),
  );
  await slot.findByRole("button", { name: "First memories" });
  await userEvent.click(slot.getByRole("button", { name: "More checkpoints" }));
  await slot.findByRole("button", { name: "First checkpoints" });
  expect(inputs.at(-1)).toMatchObject({
    memoryAfter: noteId,
    checkpointAfter: checkpointId,
  });
  slot.getByRole("combobox", { name: "Record kind" }).focus();
  await userEvent.keyboard("{Enter}{ArrowDown}{Enter}");
  await waitFor(() => expect(inputs.at(-1)?.kind).not.toBe("knowledge"));
  expect(inputs.at(-1)?.memoryAfter).toBeUndefined();
  expect(inputs.at(-1)?.checkpointAfter).toBe(checkpointId);
});

test("failed current reads show recovery rather than empty success and preserve the search draft", async () => {
  let fail = true;
  const { slot } = await recordsFixture({
    rpc: {
      botRecords: () => {
        if (fail) throw new Error("Offline");
        return {
          ...recordIndex,
          memory: { items: [], nextCursor: null },
          checkpoints: { items: [], nextCursor: null },
        };
      },
    },
  });
  await slot.findByText(/Could not read current records/);
  expect(slot.queryByText("No named checkpoints yet.")).toBeNull();
  expect(
    slot.queryByText("No retrievable records of this kind yet."),
  ).toBeNull();
  await userEvent.type(slot.getByRole("searchbox"), "Retain unsent search");
  fail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry records read" }),
  );
  await slot.findByText("No named checkpoints yet.");
  expect((slot.getByRole("searchbox") as HTMLInputElement).value).toBe(
    "Retain unsent search",
  );
});

test("forget invalidation removes an already displayed full note and never substitutes historical checkpoint content", async () => {
  let suppressed = false;
  const { slot } = await recordsFixture({
    rpc: {
      botMemory: () =>
        suppressed
          ? {
              threadId: "thr_owned",
              botId: "bot_test",
              name: "Bob",
              id: noteId,
              availability: "suppressed",
            }
          : fullNote,
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "Read full memory Keep evidence" }),
  );
  await slot.findByTestId("bb-markdown");
  suppressed = true;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await slot.findByText(/This memory is excluded from new retrieval/);
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  expect(slot.queryByText(/A retained note body beyond/)).toBeNull();
});

test("a failed full-note read preserves the selected reference and offers an explicit read retry without mutation", async () => {
  let fail = true;
  const { slot } = await recordsFixture({
    rpc: {
      botMemory: () => {
        if (fail) throw new Error("Unknown current content");
        return fullNote;
      },
    },
  });
  await userEvent.click(
    await slot.findByRole("button", { name: "Read full memory Keep evidence" }),
  );
  await slot.findByText(
    "Could not read this memory. Its current content is unknown.",
  );
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  fail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry memory read" }),
  );
  await slot.findByTestId("bb-markdown");
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "botMemory")
      .every((call) => (call.input as { id: string }).id === noteId),
  ).toBe(true);
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});
