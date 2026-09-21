// bb-plugin-graphite — the plugin's frontend.
//
// The thread header shows stack state; its side-panel tab shows lineage.
//
// Everything it draws comes from the `stack_current` RPC in server.ts, which
// reads Graphite's metadata and joins it with BB's environment state.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { STACK_ICON_REGISTRATIONS } from "@/components/icons/stack-position.tsx";
import { StackHeaderAction } from "@/components/stack/stack-header-action.tsx";
import { StackPanel } from "@/components/stack/stack-panel.tsx";

export default definePluginApp((app) => {
  for (const icon of STACK_ICON_REGISTRATIONS)
    app.experimental_icons.register(icon);

  app.slots.threadPanelAction({
    id: "stack",
    title: "Graphite stack",
    icon: "GitBranch",
    component: StackPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "stack-position",
    title: "Graphite stack position",
    component: StackHeaderAction,
  });
});
