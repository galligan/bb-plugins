import {
  definePluginApp,
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
} from "@get-bb/plugin-sdk/app";
import { BotsPanel } from "./components/bots-panel.tsx";
import { BotsHeader, useBotsTitle } from "./components/bots-header.tsx";
import { BotsSettings } from "./components/bot-settings.tsx";
import { uiContract, type Ownership } from "./lib/ui/contracts.ts";

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
