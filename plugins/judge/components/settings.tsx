import { ModelsSettings, DefaultSettings } from "./models-settings.tsx";
import { ProjectSettings, CalibrationSettings } from "./policy-settings.tsx";
import { TriggerSettings } from "./trigger-settings.tsx";
export function JudgeSettings() {
  return (
    <div className="judge-ui">
      <p className="text-xs text-muted-foreground">
        Configure a model, choose defaults, then set up optional automation
        below.
      </p>
      <ModelsSettings />
      <DefaultSettings />
      <ProjectSettings />
      <CalibrationSettings />
      <TriggerSettings />
    </div>
  );
}
