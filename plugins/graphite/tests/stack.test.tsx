// The stack tab and header action through the SDK frontend harness. Lineage
// drawing, lane widths, and the header's compact placement are layout and stay
// live checks; see docs/dev/verification.md.
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  experimental_makePanelController,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import {
  useBbNavigate,
  useSdk,
  type ExperimentalPanelTabs,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { StackPanel } from "../components/stack/stack-panel.tsx";
import type { CurrentStack, CurrentStackBranch } from "../lib/current-stack.ts";

const THREAD = "thr_api";
const PROJECT = "proj_acme";
const loaded = () => loadPluginApp(() => import("../app.tsx"));

const branch = (
  name: string,
  overrides: Partial<CurrentStackBranch> = {},
): CurrentStackBranch => ({
  name,
  isCurrent: false,
  needsRestack: false,
  isStale: false,
  threads: [],
  offshoots: [],
  ...overrides,
});

type Stacked = Extract<CurrentStack, { outcome: "stacked" }>;
const stacked = (overrides: Partial<Stacked> = {}): Stacked => ({
  outcome: "stacked",
  branch: "feat/api",
  position: 2,
  total: 3,
  placement: "middle",
  needsRestack: false,
  isStale: false,
  workingTree: "clean",
  warnings: [],
  branches: [
    branch("feat/auth", {
      threads: [{ id: "thr_auth", title: "Auth middleware" }],
    }),
    branch("feat/api", {
      isCurrent: true,
      threads: [{ id: THREAD, title: "API routes" }],
      offshoots: [
        {
          name: "spike/cache",
          column: 1,
          parent: null,
          needsRestack: true,
          isStale: false,
          threads: [],
        },
      ],
    }),
    branch("feat/ui"),
  ],
  ...overrides,
});

// The tab reads only while it is the selected, visible tab.
const selectedTab = (open = true): ExperimentalPanelTabs => ({
  open,
  selectedKey: "tab_stack",
  tabs: [
    {
      key: "tab_stack",
      title: "Graphite stack",
      status: null,
      closable: true,
      detail: {
        kind: "plugin",
        pluginId: "graphite",
        tab: {
          id: "stack",
          context: { kind: "thread" },
          availability: "action",
        },
        params: null,
      },
    },
  ],
});

async function tab(
  read: () => CurrentStack | Promise<CurrentStack>,
  panel = selectedTab(),
) {
  // The registration test pins `app.tabs[0].component` to this component.
  const slot = renderSlot(
    { component: StackPanel },
    { threadId: THREAD, environment: null, params: null },
    {
      rpc: { stack_current: read },
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: THREAD, projectId: PROJECT }),
        },
      },
      experimental_panelTabs: panel,
      context: { projectId: PROJECT, threadId: THREAD },
    },
  );
  return { slot };
}

test("registers the thread stack tab, the header action, and its three position icons", async () => {
  const app = await loaded();
  expect(app.tabs).toHaveLength(1);
  expect(app.tabs[0]).toMatchObject({
    id: "stack",
    title: "Graphite stack",
    context: { kind: "thread" },
    availability: "action",
  });
  expect(app.tabs[0]!.component).toBe(StackPanel);
  expect(app.threadActions).toHaveLength(1);
  expect(app.threadActions[0]).toMatchObject({
    id: "stack-position",
    placement: "header",
    group: "graphite",
  });
  expect(app.icons.map((icon) => icon.name).sort()).toEqual([
    "graphite-stack-bottom",
    "graphite-stack-middle",
    "graphite-stack-top",
  ]);
});

test("the tab shows loading, then the stack top-first with position, current thread, and links to other threads", async () => {
  let resolve!: (stack: CurrentStack) => void;
  const { slot } = await tab(
    () =>
      new Promise<CurrentStack>((done) => {
        resolve = done;
      }),
  );
  await slot.findByText("Loading stack…");
  resolve(stacked());
  await slot.findByText("2/3");
  expect(slot.inspection.sdkCalls.map((call) => call.method)).toEqual([
    "threads.get",
  ]);
  expect(slot.inspection.rpcCalls).toEqual([
    {
      method: "stack_current",
      input: { projectId: PROJECT, threadId: THREAD },
    },
  ]);
  expect(
    Array.from(slot.container.querySelectorAll("ol > li")).map(
      (row) => row.textContent,
    ),
  ).toEqual([
    expect.stringContaining("feat/ui"),
    expect.stringContaining("feat/api"),
    expect.stringContaining("feat/auth"),
  ]);
  // The thread being read is named, not linked; other threads are links.
  expect(slot.getByTitle("This thread").textContent).toBe("this thread");
  await userEvent.click(
    slot.getByRole("button", { name: "Open thread: Auth middleware" }),
  );
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_auth" },
  ]);
});

test("branches hanging off the chain stay hidden until their count is opened", async () => {
  const { slot } = await tab(() => stacked());
  const toggle = await slot.findByRole("button", {
    name: "1 branch off feat/api",
  });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryByText("spike/cache")).toBeNull();
  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(slot.getByText("spike/cache")).toBeTruthy();
  expect(slot.getByLabelText("Needs restack")).toBeTruthy();
  await userEvent.click(toggle);
  expect(slot.queryByText("spike/cache")).toBeNull();
});

test("restack state and metadata warnings are shown with the stack", async () => {
  const { slot } = await tab(() =>
    stacked({
      needsRestack: true,
      warnings: ["Graphite metadata changed since the last read."],
    }),
  );
  await slot.findByText("2/3");
  expect(slot.getByText("Needs restack")).toBeTruthy();
  expect(
    slot.getByText("Graphite metadata changed since the last read."),
  ).toBeTruthy();
});

test("no stack, a single unbranched branch, and a failed first read are distinct states", async () => {
  const none = await tab(() => ({ outcome: "none", reason: "not tracked" }));
  await none.slot.findByText("No Graphite stack for this thread.");
  none.slot.lifecycle.unmount();

  const single = await tab(() =>
    stacked({
      position: 1,
      total: 1,
      placement: "top",
      branches: [branch("feat/solo", { isCurrent: true })],
    }),
  );
  await single.slot.findByText("No Graphite stack for this thread.");
  single.slot.lifecycle.unmount();

  const failed = await tab(() => {
    throw new Error("host offline");
  });
  await failed.slot.findByText("Unable to load the Graphite stack.");
  expect(failed.slot.queryByText("Loading stack…")).toBeNull();
});

test("an unavailable read is an error, not an empty stack", async () => {
  const { slot } = await tab(() => ({
    outcome: "unavailable",
    reason: "environment has no host",
  }));
  await slot.findByText("Unable to load the Graphite stack.");
  expect(slot.queryByText("No Graphite stack for this thread.")).toBeNull();
});

test("refresh failures retain lineage and recovery clears the warning before confirmed absence clears the stack", async () => {
  let next: CurrentStack = stacked();
  const { slot } = await tab(() => next);
  await slot.findByText("2/3");
  next = { outcome: "unavailable", reason: "metadata unreadable" };
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await slot.findByText(
    "Unable to refresh the stack. Showing the last result.",
  );
  expect(slot.getByText("feat/api")).toBeTruthy();
  next = stacked();
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(
      slot.queryByText("Unable to refresh the stack. Showing the last result."),
    ).toBeNull(),
  );
  next = { outcome: "none", reason: "not tracked" };
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await slot.findByText("No Graphite stack for this thread.");
  expect(slot.queryByText("feat/api")).toBeNull();
});

test("a failed refresh after an empty result is visible and recovers", async () => {
  let fail = false;
  const { slot } = await tab(() => {
    if (fail) throw new Error("host offline");
    return { outcome: "none", reason: "not tracked" };
  });
  await slot.findByText("No Graphite stack for this thread.");
  fail = true;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await slot.findByText("Unable to load the Graphite stack.");
  expect(slot.queryByText("No Graphite stack for this thread.")).toBeNull();
  fail = false;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await slot.findByText("No Graphite stack for this thread.");
  expect(slot.queryByText("Unable to load the Graphite stack.")).toBeNull();
});

test("the tab does not read while it is closed or not the selected tab", async () => {
  for (const panel of [
    selectedTab(false),
    { ...selectedTab(), selectedKey: "tab_other" },
    { open: true, selectedKey: null, tabs: [] },
  ] satisfies ExperimentalPanelTabs[]) {
    const { slot } = await tab(() => stacked(), panel);
    await slot.findByText("Loading stack…");
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(slot.inspection.sdkCalls).toEqual([]);
    slot.lifecycle.unmount();
  }
});

test("the header action labels each stacked thread and opens the stack tab for it", async () => {
  const app = await loaded();
  const action = app.threadActions[0]!;
  const opened: unknown[] = [];
  const target = (id: string): PluginThreadActionTarget => ({
    id,
    projectId: PROJECT,
    parentThreadId: null,
    parentNotifications: makeThreadResponse().parentNotifications,
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: null,
  });
  const stacks: Record<string, CurrentStack> = {
    thr_api: stacked({ needsRestack: true }),
    thr_solo: { outcome: "none", reason: "not tracked" },
  };
  function Header({ threadIds }: { threadIds: string[] }) {
    const data = action.useData!({ threadIds });
    const sdk = useSdk();
    const navigate = useBbNavigate();
    return (
      <>
        {threadIds.map((id) => {
          const item = action.item({
            thread: target(id),
            data,
            sdk,
            navigate,
            experimental_panel: experimental_makePanelController({
              openTab: (request) => {
                opened.push(request);
                return true;
              },
            }),
          });
          return item === null ? null : (
            <button
              key={id}
              data-icon={item.icon}
              onClick={() => void item.run({ requestRename: () => {} })}
            >
              {item.label}
            </button>
          );
        })}
      </>
    );
  }
  const slot = renderSlot(
    { component: Header },
    { threadIds: ["thr_api", "thr_solo"] },
    {
      rpc: {
        stack_current: (input: unknown) => {
          if (
            typeof input !== "object" ||
            input === null ||
            !("threadId" in input) ||
            typeof input.threadId !== "string"
          )
            throw new Error("stack_current needs a threadId");
          return stacks[input.threadId]!;
        },
      },
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) =>
            makeThreadResponse({ id: threadId, projectId: PROJECT }),
        },
      },
    },
  );
  const button = await slot.findByRole("button", {
    name: "Graphite 2/3 · Needs restack",
  });
  expect(button.getAttribute("data-icon")).toBe("graphite-stack-middle");
  // A thread with no stack gets no header action.
  expect(slot.getAllByRole("button")).toHaveLength(1);
  await waitFor(() =>
    expect(slot.inspection.rpcCalls.map((call) => call.input).sort()).toEqual([
      { projectId: PROJECT, threadId: "thr_api" },
      { projectId: PROJECT, threadId: "thr_solo" },
    ]),
  );
  await userEvent.click(button);
  expect(opened).toEqual([
    {
      tab: { id: "stack", context: { kind: "thread" }, availability: "action" },
      title: "Graphite stack",
      params: { projectId: PROJECT },
    },
  ]);
});
