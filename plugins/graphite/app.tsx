// bb-plugin-graphite — the plugin's frontend.
//
// One surface: a row above the composer reporting where the checked-out branch
// sits in its Graphite stack, and what hangs off it. It renders nothing when
// there is no stack, which collapses BB's banner region to zero height.
//
// Everything it draws comes from the `stack_current` RPC in server.ts, which
// reads Graphite's metadata and joins it with BB's environment state.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { STACK_ICON_REGISTRATIONS } from "@/components/icons/stack-position.tsx";
import { StackBanner } from "@/components/stack/stack-banner.tsx";

export default definePluginApp((app) => {
  for (const icon of STACK_ICON_REGISTRATIONS)
    app.experimental_icons.register(icon);

  app.composer.customize({
    id: "stack",
    banners: [{ id: "stack-position", chrome: "card", component: StackBanner }],
  });
});
