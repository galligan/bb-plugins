import {
  definePluginApp,
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
} from "@get-bb/plugin-sdk/app";
import { BotsPanel } from "./components/bots-panel.tsx";
import { BotsHeader, useBotsTitle } from "./components/bots-header.tsx";
import { BotsSettings } from "./components/bot-settings.tsx";
import {
  BotComposerSettings,
  BotInfoRow,
  BotContextCardRow,
} from "./components/conversation-context.tsx";
import { uiContract, type Ownership } from "./lib/ui/contracts.ts";
import {
  recordsTab,
  BotRecordsPanel,
  BotRecordsInfo,
  useRecordsVisible,
} from "./components/records/panel.tsx";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "bots",
    path: "bots",
    title: "Bots",
    icon: "Bot",
    component: BotsPanel,
    headerContent: BotsHeader,
    experimental_usePageTitle: useBotsTitle,
  });
  app.slots.settingsSection({ id: "bots", component: BotsSettings });
  app.slots.experimental_tab({
    ...recordsTab,
    title: "Bot records",
    icon: "BookOpen",
    layout: "padded",
    useVisible: useRecordsVisible,
    component: BotRecordsPanel,
  });
  app.composer.customize({
    id: "bot-settings",
    scopes: ["thread"],
    actions: [{ id: "settings", component: BotComposerSettings }],
  });
  app.slots.experimental_threadInfoRow({
    id: "bot-identity",
    group: "1_thread",
    component: BotInfoRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "bot-records",
    group: "1_thread",
    component: BotRecordsInfo,
  });
  app.slots.experimental_threadContextCardRow({
    id: "bot-identity",
    group: "1_thread",
    component: BotContextCardRow,
  });
  app.slots.experimental_threadAction<Ownership | undefined>({
    id: "identity",
    title: "Bot identity",
    icon: "Bot",
    group: "bots",
    placement: "header",
    useData: ({ threadIds }) =>
      useRpcKeyedQuery({
        contract: uiContract,
        method: "ownership",
        keys: threadIds,
      }).data,
    item: ({ thread, data, navigate }) => {
      const owner = data?.[thread.id];
      return owner
        ? {
            label: `@${owner.name}`,
            icon: "Bot",
            run: () => navigate.toPluginPanel("bots", { subPath: owner.botId }),
          }
        : null;
    },
  });
});
