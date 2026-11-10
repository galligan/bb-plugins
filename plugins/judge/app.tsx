import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { JudgeSettings } from "./components/settings.tsx";
import {
  VerdictInfo,
  VerdictBadge,
  useVerdictRows,
} from "./components/verdicts.tsx";
import "./app.css";
export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "judge",
    title: "Models and verdicts",
    component: JudgeSettings,
  });
  app.slots.experimental_threadInfoRow({
    id: "verdict",
    group: "8_judge",
    component: VerdictInfo,
  });
  app.slots.experimental_threadRowMetadata({
    id: "verdict",
    order: 40,
    useData: useVerdictRows,
    component: VerdictBadge,
  });
});
