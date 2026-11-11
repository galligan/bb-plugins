import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RadioPanel } from "./components/radio/panel.tsx";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "radio",
    title: "Radio",
    icon: "Radio",
    path: "radio",
    component: RadioPanel,
  });
});
