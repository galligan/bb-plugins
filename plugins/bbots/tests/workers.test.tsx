// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  workersFixture,
  worker,
  nativeThread,
} from "./workers-fixture.test.ts";
import { workerOverviewContract } from "../lib/work/overview.ts";

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

test("actual Bots navigation uses mapped worker IDs with native title/status and separate parent/report actions, preserving the composer", async () => {
  const slot = await workersFixture({
    sidebarThreads: {
      threads: [
        nativeThread(),
        nativeThread("thr_foreign", {
          displayTitle: "Unrelated personal thread",
        }),
      ],
    },
    composer: {
      scope: { kind: "thread", threadId: "thr_unrelated" },
      text: "Unsent user draft",
      attachmentCount: 1,
    },
  });
  const open = await slot.findByRole("button", {
    name: "Open worker → @Bob Renamed task",
  });
  expect(slot.getByText("Thread working")).toBeTruthy();
  expect(
    slot.container.querySelector('[data-thread-status-glyph="runtime"]'),
  ).toBeTruthy();
  expect(slot.queryByText("Unrelated personal thread")).toBeNull();
  await userEvent.click(open);
  await userEvent.click(slot.getByText("Relationships and setup"));
  await userEvent.click(
    slot.getByRole("button", {
      name: "Open report destination for Investigate",
    }),
  );
  await userEvent.click(
    slot.getByRole("button", { name: "Open requested parent for Investigate" }),
  );
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_worker" },
    { method: "toThread", threadId: "thr_owned" },
    { method: "toThread", threadId: "thr_parent" },
  ]);
  expect(slot.inspection.composer.text).toBe("Unsent user draft");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.submits).toHaveLength(0);
  expect(slot.inspection.composer.selections).toHaveLength(0);
  expect(
    slot.inspection.sdkCalls.some((call) => call.method.startsWith("threads.")),
  ).toBe(false);
});

test("unbound uncertain creation has no fake open action, and an uncached mapped worker has unknown activity rather than inferred completion", async () => {
  const slot = await workersFixture({
    rpc: {
      workerOverview: () => ({
        botId: "bot_test",
        offset: 0,
        nextOffset: null,
        hasMoreBeyondLimit: false,
        workers: [
          worker,
          {
            ...worker,
            conversationId: "conv_uncertain",
            title: "Uncertain task",
            threadId: null,
            phase: "spawning",
            error: "Lost creation receipt",
          },
        ],
      }),
    },
  });
  await slot.findByRole("button", { name: "Open worker Investigate" });
  expect(
    slot.queryByRole("button", { name: "Open worker Uncertain task" }),
  ).toBeNull();
  expect(
    slot.getByText("Not in the active BB view; current activity is unknown."),
  ).toBeTruthy();
  for (const summary of slot.getAllByText("Relationships and setup"))
    await userEvent.click(summary);
  expect(
    slot.getByText("Creation outcome needs inspection; no automatic retry."),
  ).toBeTruthy();
  expect(slot.getByText("Lost creation receipt")).toBeTruthy();
  expect(
    slot.queryByRole("button", { name: /resume|retry creation|unarchive/i }),
  ).toBeNull();
  expect(slot.inspection.navigateCalls).toHaveLength(0);
});

test.each(["waiting", "failed"] as const)(
  "native %s queue indicator remains a host activity fact and does not trigger a send or retry",
  async (queuedWork) => {
    const slot = await workersFixture({
      sidebarThreads: {
        threads: [
          nativeThread("thr_worker", {
            status: "idle",
            runtimeStatus: "idle",
            queuedWork,
          }),
        ],
      },
    });
    await slot.findByText(
      queuedWork === "failed"
        ? "Queued message failed to send"
        : "Thread has a message waiting to send",
    );
    expect(
      slot.container.querySelector(
        `[data-thread-status-glyph="queued-${queuedWork}"]`,
      ),
    ).toBeTruthy();
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    expect(
      slot.inspection.sdkCalls.some((call) =>
        call.method.startsWith("threads."),
      ),
    ).toBe(false);
  },
);

test("worker paging keeps at most ten mounted rows and explicitly discloses the retained first100 boundary", async () => {
  const offsets: number[] = [];
  const slot = await workersFixture({
    rpc: {
      workerOverview: (input) => {
        const value = workerOverviewContract.workerOverview.input.parse(input);
        offsets.push(value.offset);
        return {
          botId: value.botId,
          offset: value.offset,
          nextOffset: value.offset === 0 ? 10 : null,
          hasMoreBeyondLimit: true,
          workers: Array.from({ length: 10 }, (_, i) => ({
            ...worker,
            conversationId: `conv_${i + value.offset}`,
            threadId: `thr_${i + value.offset}`,
            title: `Task ${i + value.offset}`,
          })),
        };
      },
    },
  });
  await slot.findByRole("button", { name: "Open worker Task 0" });
  expect(slot.getAllByRole("button", { name: /^Open worker / })).toHaveLength(
    10,
  );
  await userEvent.click(slot.getByRole("button", { name: "More workers" }));
  await slot.findByRole("button", { name: "Open worker Task 10" });
  expect(slot.queryByRole("button", { name: "Open worker Task 0" })).toBeNull();
  expect(slot.getAllByRole("button", { name: /^Open worker / })).toHaveLength(
    10,
  );
  await userEvent.click(slot.getByRole("button", { name: "Previous workers" }));
  await slot.findByRole("button", { name: "Open worker Task 0" });
  expect(offsets).toContain(10);
  expect(slot.getByText(/first 100 worker records/)).toBeTruthy();
});

test("failed ownership reads never look like empty success and explicit retry recovers without writes", async () => {
  let fail = true;
  const slot = await workersFixture({
    rpc: {
      workerOverview: () => {
        if (fail) throw new Error("Offline");
        return {
          botId: "bot_test",
          offset: 0,
          nextOffset: null,
          hasMoreBeyondLimit: false,
          workers: [],
        };
      },
    },
  });
  await slot.findByText(/Could not read owned workers/);
  expect(slot.queryByText(/No worker records on this page/)).toBeNull();
  fail = false;
  await userEvent.click(
    slot.getByRole("button", { name: "Retry workers read" }),
  );
  await slot.findByText(/No worker records on this page/);
  expect(
    slot.inspection.rpcCalls.every(
      (call) => !/create|resume|send|update/i.test(call.method),
    ),
  ).toBe(true);
});

test("hidden worker view pauses its reads and unmounts native rows; showing it refreshes without waking work", async () => {
  let reads = 0;
  const slot = await workersFixture({
    sidebarThreads: { threads: [nativeThread()] },
    rpc: {
      workerOverview: () => {
        reads++;
        return {
          botId: "bot_test",
          offset: 0,
          nextOffset: null,
          hasMoreBeyondLimit: false,
          workers: [worker],
        };
      },
    },
  });
  await slot.findByRole("button", { name: "Open worker → @Bob Renamed task" });
  const before = reads;
  visibility(false);
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(reads).toBe(before);
  expect(slot.queryByRole("button", { name: /^Open worker / })).toBeNull();
  expect(
    slot.getByRole("button", { name: "Refresh workers" }).matches(":disabled"),
  ).toBe(true);
  visibility(true);
  await waitFor(() => expect(reads).toBeGreaterThan(before));
  expect(slot.inspection.navigateCalls).toHaveLength(0);
});

test("a failed native cache keeps durable worker ownership visible without claiming live activity", async () => {
  const slot = await workersFixture({
    sidebarThreads: { status: "error", threads: [nativeThread()] },
  });
  await slot.findByRole("button", { name: "Open worker Investigate" });
  expect(slot.queryByText("Thread working")).toBeNull();
  expect(
    slot.getByText(
      "Native thread status is unavailable. Worker ownership is still recorded.",
    ),
  ).toBeTruthy();
});
