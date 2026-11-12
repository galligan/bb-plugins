// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { commitmentUiContract } from "../lib/ui/commitment-contracts.ts";
import { recordsFixture } from "./records-fixture.test.ts";
import { nativeThread } from "./workers-fixture.test.ts";

afterEach(cleanup);
const id = "cmt_00000000-0000-4000-8000-000000000001";
const list = commitmentUiContract.botCommitments.output.parse({
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Bob",
  nextCursor: null,
  records: [
    {
      id,
      revision: 1,
      owner: {
        conversationId: "conv_worker",
        threadId: "thr_worker",
        role: "worker",
      },
      excerpt: "Prepare evidence",
      referenceKind: "tasks",
      localStatus: null,
      evidenceCount: 1,
    },
  ],
});
const detail = commitmentUiContract.botCommitment.output.parse({
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Bob",
  id,
  revision: 1,
  owner: list.records[0]!.owner,
  what: "Prepare evidence",
  evidence: ["thread:original#msg=1"],
  reference: { kind: "tasks", boardId: "tracker_owned", taskId: "task_one" },
  author: "user",
  reason: "Explicit obligation",
  authority: "tasks",
  availability: "available",
  status: "done",
  task: { key: "OWN-1", title: "Source task" },
  limitation: null,
  inspectedAt: "2026-11-11T20:00:00.000Z",
});

test("the list checks no linked status until explicit inspection and owns no task mutation", async () => {
  let reads = 0;
  const { slot } = await recordsFixture({
    rpc: {
      botCommitments: () => list,
      botCommitment: () => {
        reads++;
        return detail;
      },
    },
  });
  await slot.findByText(/Tasks · status not checked/);
  expect(reads).toBe(0);
  const inspect = slot.getByRole("button", {
    name: "Inspect commitment Prepare evidence",
  });
  await userEvent.click(inspect);
  await slot.findByText("Tasks · done");
  expect(document.activeElement).toBe(inspect);
  expect(reads).toBe(1);
  expect(slot.getByText("OWN-1 · Source task")).toBeTruthy();
  expect(slot.getByText(/Inspected 2026-11-11/)).toBeTruthy();
  expect(
    slot.queryByRole("button", {
      name: /close|mark done|create task|resume|send/i,
    }),
  ).toBeNull();
  expect(slot.inspection.sdkCalls).toHaveLength(0);
  expect(
    slot.inspection.rpcCalls.some((call) =>
      /close|update|create|send|resume/i.test(call.method),
    ),
  ).toBe(false);
  await userEvent.click(inspect);
  await waitFor(() => expect(slot.queryByText("Tasks · done")).toBeNull());
  expect(document.activeElement).toBe(inspect);
  expect(reads).toBe(1);
});

test.each([
  "source-reconciliation-required",
  "changed-during-read",
  "unavailable",
] as const)(
  "a refreshed %s result does not retain a previous done status",
  async (availability) => {
    let current = detail;
    const { slot } = await recordsFixture({
      rpc: { botCommitments: () => list, botCommitment: () => current },
    });
    await userEvent.click(
      await slot.findByRole("button", {
        name: "Inspect commitment Prepare evidence",
      }),
    );
    await slot.findByText("Tasks · done");
    current = {
      ...detail,
      availability,
      status: null,
      task: null,
      limitation: "Preserve its recorded authority and inspect the source.",
    };
    await userEvent.click(
      slot.getByRole("button", { name: "Refresh obligation" }),
    );
    await slot.findByText(/status is unknown/);
    expect(slot.queryByText("Tasks · done")).toBeNull();
    expect(slot.queryByText("OWN-1 · Source task")).toBeNull();
    expect(
      slot.getByText("Preserve its recorded authority and inspect the source."),
    ).toBeTruthy();
  },
);

test("a Markdown source uses its recorded host/path and never infers completion from arbitrary text", async () => {
  const { slot } = await recordsFixture({
    context: { threadId: "thr_ambient", projectId: "proj_unrelated" },
    rpc: {
      botCommitments: () => ({
        ...list,
        records: [{ ...list.records[0], referenceKind: "markdown" }],
      }),
      botCommitment: () => ({
        ...detail,
        availability: "manual-source-read",
        authority: "markdown",
        status: null,
        task: null,
        reference: {
          kind: "markdown",
          hostId: "host_original",
          path: "/original/home/tasks.md",
          reference: "Evidence section",
        },
      }),
    },
  });
  await userEvent.click(
    await slot.findByRole("button", {
      name: "Inspect commitment Prepare evidence",
    }),
  );
  await slot.findByText(
    "Read the recorded task file; its status is not inferred.",
  );
  await userEvent.click(
    slot.getByRole("link", { name: "Open recorded tasks.md" }),
  );
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "host",
        hostId: "host_original",
        path: "/original/home/tasks.md",
      },
      location: null,
    },
  });
  expect(slot.queryByText("Tasks · done")).toBeNull();
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});

test("manual closed obligations remain distinct from linked task status and owner links use host-provided addresses", async () => {
  const { slot } = await recordsFixture({
    sidebarThreads: {
      threads: [nativeThread("thr_worker", { href: "/host-address/owner" })],
    },
    rpc: {
      botCommitments: () => ({
        ...list,
        records: [
          {
            ...list.records[0],
            referenceKind: "unlinked",
            localStatus: "closed",
          },
        ],
      }),
      botCommitment: () => ({
        ...detail,
        availability: "local",
        authority: "commitment",
        status: "closed",
        task: null,
        reference: { kind: "unlinked", status: "closed" },
      }),
    },
  });
  await slot.findByText(/Manual obligation · closed/);
  await userEvent.click(
    slot.getByRole("button", { name: "Inspect commitment Prepare evidence" }),
  );
  await slot.findByText("Manual obligation · closed");
  const owner = slot.getByRole("link", { name: "Open owed-by conversation" });
  expect(owner.getAttribute("href")).toBe("/host-address/owner");
  expect(slot.getByText("Owed by an owned worker conversation")).toBeTruthy();
  expect(slot.queryByText(/Open Tasks in BB to inspect/)).toBeNull();
});

test("failed and empty commitment lists are distinct, and selected read failure offers a bounded explicit retry", async () => {
  let failList = true,
    failDetail = true;
  const { slot } = await recordsFixture({
    rpc: {
      botCommitments: () => {
        if (failList) throw new Error("Disconnected");
        return list;
      },
      botCommitment: () => {
        if (failDetail) throw new Error("Read failed");
        return detail;
      },
    },
  });
  await slot.findByText(/Could not read commitments/);
  expect(slot.queryByText("No commitments on this page.")).toBeNull();
  failList = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry commitments read" }),
  );
  await userEvent.click(
    await slot.findByRole("button", {
      name: "Inspect commitment Prepare evidence",
    }),
  );
  await slot.findByText(
    "Could not inspect this obligation. No current status is established.",
  );
  failDetail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry obligation read" }),
  );
  await slot.findByText("Tasks · done");
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "botCommitment"),
  ).toHaveLength(2);
  expect(slot.inspection.sdkCalls).toHaveLength(0);
});

test("local obligation paging reads only its own cursor and never requests every linked task", async () => {
  const inputs: unknown[] = [];
  const { slot } = await recordsFixture({
    rpc: {
      botCommitments: (input) => {
        const value = commitmentUiContract.botCommitments.input.parse(input);
        inputs.push(value);
        return { ...list, records: [], nextCursor: value.after ? null : id };
      },
    },
  });
  await slot.findByText("No commitments on this page.");
  await userEvent.click(slot.getByRole("button", { name: "More commitments" }));
  await slot.findByRole("button", { name: "First commitments" });
  await waitFor(() =>
    expect(inputs.at(-1)).toEqual({ threadId: "thr_owned", after: id }),
  );
  expect(
    slot.inspection.rpcCalls.some((call) => call.method === "botCommitment"),
  ).toBe(false);
});
