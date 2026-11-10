import { ModelsSettings, DefaultSettings } from "./models-settings.tsx";
import { ProjectSettings, CalibrationSettings } from "./policy-settings.tsx";
import { TriggerSettings } from "./trigger-settings.tsx";
export function JudgeSettings() {
  return (
    <div className="judge-ui">
      <p>
        Enter connection credentials only in BB's connection fields on this
        settings page. Judge never reads secrets back to this interface. Saving
        credentials does not start paid requests.
      </p>
      <p>
        Models and saved sets are global. Project switches and filters narrow
        applicability. Private data is blocked unless an explicitly selected
        model permits it.
      </p>
      <ModelsSettings />
      <DefaultSettings />
      <ProjectSettings />
      <CalibrationSettings />
      <TriggerSettings />
      <small>
        The thread Info row works independently of sidebar metadata. Optional
        sidebar badges require the Judge setting above plus BB's
        threadRowMetadata experiment and Organize → Rows → Metadata.
      </small>
    </div>
  );
}
