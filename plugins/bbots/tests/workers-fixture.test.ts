import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { WorkerOverviewRow } from "../lib/work/overview.ts";
import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { view, soul } from "./fixture.ts";

export const worker: WorkerOverviewRow = {
  conversationId: "conv_worker",
  title: "Investigate",
  threadId: "thr_worker",
  phase: "bound",
  error: null,
  requestedParentThreadId: "thr_parent",
  report: {
    kind: "conversation",
    threadId: "thr_owned",
    isOwnMain: true,
    revision: 1,
  },
};
export function nativeThread(
  id = "thr_worker",
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "proj_home",
    title: "→ @Bob Renamed task",
    titleFallback: null,
    displayTitle: "→ @Bob Renamed task",
    parentThreadId: "thr_parent",
    lifecycleOwnerThreadId: null,
    parentNotifications: "off",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: "bbots",
    providerId: "codex",
    status: "active",
    runtimeStatus: "active",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
    },
    indicator: "runtime",
    indicatorLabel: "Thread working",
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/fixture/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  };
}
export async function workersFixture(options: RenderSlotOptions = {}) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "bot_test" },
    {
      tabVisible: false,
      ...options,
      rpc: {
        list: () => ({ bots: [view.bot], hasMore: false }),
        show: () => view,
        soulShow: () => soul,
        taskSource: () => ({
          kind: "unconfigured",
          availability: "unconfigured",
          boardId: null,
          file: null,
        }),
        workerOverview: () => ({
          botId: "bot_test",
          offset: 0,
          workers: [worker],
          nextOffset: null,
          hasMoreBeyondLimit: false,
        }),
        ...options.rpc,
      },
      sdk: {
        hosts: {
          list: async () => [
            makeHostResponse({ id: "host_test", status: "connected" }),
          ],
        },
        ...options.sdk,
      },
    },
  );
}
