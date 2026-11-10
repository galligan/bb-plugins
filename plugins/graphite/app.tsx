// bb-plugin-graphite — the plugin's frontend.
//
// The thread header shows stack state; its side-panel tab shows lineage.
//
// Everything it draws comes from the `stack_current` RPC in server.ts, which
// reads Graphite's metadata and joins it with BB's environment state.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { STACK_ICON_REGISTRATIONS } from "@/components/icons/stack-position.tsx";
import { useCurrentStacks } from "@/components/stack/use-current-stack.ts";
import { stackHeaderAction } from "@/lib/header-action.ts";
import { StackPanel } from "@/components/stack/stack-panel.tsx";

export default definePluginApp((app) => {
  for (const icon of STACK_ICON_REGISTRATIONS)
    app.experimental_icons.register(icon);

  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "stack",
    title: "Graphite stack",
    icon: "GitBranch",
    component: StackPanel,
  });
  app.slots.experimental_threadAction({
    id: "stack-position",
    title: "Graphite stack position",
    icon: "GitBranch",
    group: "graphite",
    placement: "header",
    useData: useCurrentStacks,
    item: ({ thread, data, experimental_panel }) =>
      stackHeaderAction(
        data.get(thread.id)?.stack,
        () => {
          experimental_panel.openTab({
            tab: {
              id: "stack",
              context: { kind: "thread" },
              availability: "action",
            },
            title: "Graphite stack",
            params: { projectId: thread.projectId },
          });
        },
        data.get(thread.id)?.error,
      ),
  });
});
