import { ModelsSettings, DefaultSettings } from "./models-settings.tsx";
import { ProjectSettings, CalibrationSettings } from "./policy-settings.tsx";
import { TriggerSettings } from "./trigger-settings.tsx";
export function JudgeSettings() {
  return (
    <div className="judge-ui judge-settings">
      <ModelsSettings />
      <DefaultSettings />
      <ProjectSettings />
      <CalibrationSettings />
      <TriggerSettings />
    </div>
  );
}
