// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  recordsFixture,
  checkpointId,
  recordIndex,
} from "./records-fixture.test.ts";
import { checkpointInspectContract } from "../lib/ui/checkpoint-inspect.ts";
import { BotRecordsPanel } from "../components/records/panel.tsx";

const first = checkpointInspectContract.botCheckpoint.output.parse({
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Renamed Bob",
  checkpoint: recordIndex.checkpoints.items[0],
  profile: { name: "Bob", revision: 1 },
  selectedDocuments: 2,
  after: null,
  document: {
    id: "doc_soul",
    revision: 2,
    author: "user",
    reason: "Original soul",
    createdAt: "2026-11-11T19:00:00Z",
    kind: "soul",
    topic: "SOUL.md",
    markdown: "# Saved soul",
    basis: null,
    sources: [],
    sourceCount: 0,
  },
  nextCursor: "doc_soul",
});
const next = checkpointInspectContract.botCheckpoint.output.parse({
  ...first,
  after: "doc_soul",
  nextCursor: null,
  document: {
    ...first.document!,
    id: "doc_memory",
    kind: "knowledge",
    topic: "Historical knowledge",
    markdown: "Saved evidence",
    basis: "inference",
    sources: ["thread:origin#msg=3"],
    sourceCount: 25,
  },
});
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
async function open(slot: Awaited<ReturnType<typeof recordsFixture>>["slot"]) {
  await userEvent.click(await slot.findByText("Before edits"));
  const trigger = slot.getByRole("button", {
    name: "Inspect checkpoint Before edits",
  });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
}

test("explicit native checkpoint inspection pages historical Markdown and returns keyboard focus without changing the composer", async () => {
  const { slot } = await recordsFixture({
    composer: {
      text: "Keep draft",
      attachmentCount: 1,
      selection: { providerId: "codex", model: "fixture-model" },
    },
    rpc: {
      botCheckpoint: (input) =>
        (input as { after?: string }).after ? next : first,
    },
  });
  await slot.findByText("Before edits");
  expect(
    slot.inspection.rpcCalls.filter((c) => c.method === "botCheckpoint"),
  ).toHaveLength(0);
  await open(slot);
  expect((await slot.findByTestId("bb-markdown")).textContent).toBe(
    "# Saved soul",
  );
  expect(document.activeElement).toBe(
    slot.getByRole("button", { name: "Back to checkpoints" }),
  );
  expect(slot.getByText("@Bob · Revision 1")).toBeTruthy();
  expect(slot.getByText("2 documents before current exclusions")).toBeTruthy();
  expect(slot.inspection.rpcCalls).toContainEqual(
    expect.objectContaining({
      method: "botCheckpoint",
      input: {
        threadId: "thr_owned",
        expectedBotId: "bot_test",
        id: checkpointId,
      },
    }),
  );
  await userEvent.click(
    slot.getByRole("button", { name: "Next selected document" }),
  );
  await slot.findByText("Historical knowledge");
  expect(slot.getByTestId("bb-markdown").textContent).toBe("Saved evidence");
  await userEvent.click(slot.getByText("Evidence sources (25)"));
  expect(slot.getByText("thread:origin#msg=3")).toBeTruthy();
  expect(slot.getByText("Showing the first 1 sources.")).toBeTruthy();
  expect(
    (
      slot.getByRole("button", {
        name: "Next selected document",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.click(
    slot.getByRole("button", { name: "First selected document" }),
  );
  await slot.findByText("SOUL.md");
  slot.getByRole("button", { name: "Back to checkpoints" }).focus();
  await userEvent.keyboard("{Enter}");
  await slot.findByText("Before edits");
  expect(document.activeElement).toBe(
    slot.getByRole("button", { name: "Inspect checkpoint Before edits" }),
  );
  expect(slot.inspection.composer.text).toBe("Keep draft");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.selection).toEqual({
    providerId: "codex",
    model: "fixture-model",
  });
  expect(slot.inspection.composer.submits).toHaveLength(0);
  expect(slot.inspection.sdkCalls).toHaveLength(0);
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  expect(
    slot.inspection.rpcCalls.some((c) =>
      /restore|send|create|forget/i.test(c.method),
    ),
  ).toBe(false);
});

test("failed checkpoint reads show unknown content and retry deliberately without false empty state", async () => {
  let fail = true;
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpoint: () => {
        if (fail) throw new Error("offline");
        return { ...first, document: null, nextCursor: null };
      },
    },
  });
  await open(slot);
  await slot.findByText(/Could not read this checkpoint page/);
  expect(slot.queryByText(/No retrievable selected document/)).toBeNull();
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  fail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry checkpoint read" }),
  );
  await slot.findByText(/No retrievable selected document/);
  expect(slot.getByText("2 documents before current exclusions")).toBeTruthy();
});

test.each(["thread", "bot", "checkpoint", "cursor"])(
  "mismatched %s responses cannot render checkpoint bodies",
  async (mismatch) => {
    const response = {
      ...first,
      ...(mismatch === "thread" ? { threadId: "thr_elsewhere" } : {}),
      ...(mismatch === "bot" ? { botId: "bot_elsewhere" } : {}),
      ...(mismatch === "checkpoint"
        ? {
            checkpoint: {
              ...first.checkpoint,
              id: "chk_00000000-0000-4000-8000-000000000099",
            },
          }
        : {}),
      ...(mismatch === "cursor" ? { after: "unexpected-cursor" } : {}),
    };
    const { slot } = await recordsFixture({
      rpc: { botCheckpoint: () => response },
    });
    await open(slot);
    await slot.findByText(/Could not read this checkpoint page/);
    expect(slot.queryByTestId("bb-markdown")).toBeNull();
  },
);

test("hiding pauses inspection and retains its selected page without taking host focus on return", async () => {
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpoint: (input) =>
        (input as { after?: string }).after ? next : first,
    },
  });
  await open(slot);
  await slot.findByText("SOUL.md");
  await userEvent.click(
    slot.getByRole("button", { name: "Next selected document" }),
  );
  await slot.findByText("Historical knowledge");
  visibility(false);
  await slot.findByText("Record reads pause while this tab is hidden.");
  const before = slot.inspection.rpcCalls.filter(
    (c) => c.method === "botCheckpoint",
  ).length;
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(
    slot.inspection.rpcCalls.filter((c) => c.method === "botCheckpoint"),
  ).toHaveLength(before);
  const host = document.createElement("button");
  document.body.append(host);
  try {
    host.focus();
    visibility(true);
    await slot.findByText("Historical knowledge");
    expect(document.activeElement).toBe(host);
    expect(
      slot.inspection.rpcCalls
        .filter((c) => c.method === "botCheckpoint")
        .at(-1)?.input,
    ).toEqual({
      threadId: "thr_owned",
      expectedBotId: "bot_test",
      id: checkpointId,
      after: "doc_soul",
    });
    slot.lifecycle.unmount();
    const unmounted = slot.inspection.rpcCalls.length;
    await slot.behavior.experimental_invalidateRpc(["bots"]);
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toHaveLength(unmounted),
    );
  } finally {
    host.remove();
  }
});

test("late checkpoint responses after switching to an unowned thread cannot expose saved content", async () => {
  let finish!: (value: typeof first) => void;
  const { slot } = await recordsFixture({
    rpc: {
      botCheckpoint: () =>
        new Promise<typeof first>((resolve) => {
          finish = resolve;
        }),
    },
  });
  await open(slot);
  await slot.findByText("Reading checkpoint…");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  slot.lifecycle.rerender(
    <BotRecordsPanel threadId="thr_unowned" environment={null} />,
  );
  await slot.findByText(
    "Open Bot records from an owned main or worker conversation.",
  );
  await act(async () => {
    finish(first);
  });
  expect(slot.queryByTestId("bb-markdown")).toBeNull();
  expect(slot.queryByText("Saved profile")).toBeNull();
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});

test("a delayed list refresh after Back does not take focus from a host control", async () => {
  let listReads = 0;
  let finish!: (value: typeof recordIndex) => void;
  const { slot } = await recordsFixture({
    rpc: {
      botRecords: () =>
        ++listReads === 1
          ? recordIndex
          : new Promise<typeof recordIndex>((resolve) => {
              finish = resolve;
            }),
      botCheckpoint: () => first,
    },
  });
  await open(slot);
  await slot.findByText("SOUL.md");
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  await userEvent.click(
    slot.getByRole("button", { name: "Back to checkpoints" }),
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const host = document.createElement("button");
  document.body.append(host);
  try {
    host.focus();
    await act(async () => {
      finish(recordIndex);
    });
    await slot.findByText("Before edits");
    expect(document.activeElement).toBe(host);
  } finally {
    host.remove();
  }
});
