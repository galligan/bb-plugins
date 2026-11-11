import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { view, soul } from "./fixture.ts";
import { provider, execution } from "./execution-fixture.ts";
import { soulStateSchema, defaultsStateSchema } from "../lib/soul/contracts.ts";

export const savedSoul = soulStateSchema.parse({
  ...soul,
  current: {
    id: "doc_soul",
    botId: view.bot.id,
    name: "SOUL.md",
    revision: 1,
    markdown: "Be practical and preserve evidence.",
    author: "user",
    reason: "Initial choice",
    createdAt: "now",
  },
  lastSuppliedRevision: 1,
  pending: "unverified",
});
export const savedDefaults = defaultsStateSchema.parse({
  revision: 1,
  scope: "future-conversations",
  automaticFallback: "disabled",
  defaults: {
    main: {
      providerId: "codex",
      model: "gpt-6.1-sol",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
    },
    worker: null,
    fallback: { providerId: "codex", model: "fallback-model" },
  },
  effectiveWorker: {
    providerId: "codex",
    model: "gpt-6.1-sol",
    reasoningLevel: "high",
    permissionMode: "accept-edits",
  },
});
type Handler = (input: unknown) => unknown | Promise<unknown>;
export async function settingsFixture(
  rpc: Record<string, Handler> = {},
  subPath?: string,
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const options = {
    tabVisible: false,
    rpc: {
      list: () => ({ bots: [view.bot], hasMore: false }),
      show: () => view,
      soulShow: () => savedSoul,
      defaultsShow: () => savedDefaults,
      ...rpc,
    },
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({
            id: "host_test",
            name: "Fixture machine",
            status: "connected",
          }),
        ],
      },
      providers: {
        list: async () => [provider],
        models: async () => execution,
      },
    },
  };
  const slot =
    subPath === undefined
      ? renderSlot(app.settingsSections[0]!, {}, options)
      : renderSlot(app.navPanels[0]!, { subPath }, options);
  return { app, slot };
}
