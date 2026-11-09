// bb-plugin-rex — the plugin's frontend.
//
// One surface: a "Rex" tab in a thread's side panel that shows one live Rex
// terminal pane, read-only. The bytes come from the `/stream` route in
// server.ts; the vendored libghostty-vt WASM turns them into a terminal, and
// components/terminal-view.tsx draws it.

import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { RexTab } from "./components/rex-tab.tsx";

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "pane",
    title: "Rex",
    icon: "Terminal",
    tooltip: "Watch a Rex terminal pane",
    layout: "flush",
    component: RexTab,
  });
});
