import { Button, Input, Checkbox } from "./controls.tsx";
import { useCallback, useState } from "react";
import { useJudgeRpc, useRead, useAction } from "./hooks.ts";
import { Group, Field, Feedback } from "./controls.tsx";
export function ProjectSettings() {
  const rpc = useJudgeRpc();
  const [draft, setDraft] = useState("");
  const [projectId, setProject] = useState("");
  const load = useCallback(
    () =>
      projectId
        ? rpc.call("projects.get", { projectId })
        : Promise.resolve(null),
    [rpc, projectId],
  );
  const read = useRead(`project:${projectId}`, load);
  const action = useAction(read.refresh);
  return (
    <Group title="Project applicability">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft === projectId) read.refresh();
          else setProject(draft);
        }}
      >
        <Field label="Project ID">
          <Input
            value={draft}
            maxLength={128}
            required
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <Button type="submit">Load project policy</Button>
      </form>
      {read.data && (
        <>
          <p>
            {read.data.projectId}:{" "}
            {read.data.enabled ? "Judge allowed" : "Judge disabled"}. Saved-set
            and binding project filters also apply.
          </p>
          <Button
            type="button"
            disabled={action.pending}
            onClick={() => {
              void action.act(
                () =>
                  rpc.call("projects.set", {
                    projectId: read.data!.projectId,
                    enabled: !read.data!.enabled,
                  }),
                "Project policy saved; bindings disabled and calibration retired.",
              );
            }}
          >
            {read.data.enabled
              ? "Disable Judge for project"
              : "Allow Judge for project"}
          </Button>
        </>
      )}
      <small>
        Project changes disable bindings; enabling a project never enables a
        binding or calls a provider.
      </small>
      <Feedback error={read.error ?? action.error} notice={action.notice} />
    </Group>
  );
}
function AcceptedCalibration({ id }: { id: string }) {
  const rpc = useJudgeRpc();
  const load = useCallback(
    () => rpc.call("calibration.get", { id }),
    [rpc, id],
  );
  const read = useRead(`accepted:${id}`, load);
  return (
    <>
      <p>
        {read.data
          ? `Current acceptance: ${read.data.testRunId}`
          : read.data === null
            ? "No current calibration acceptance."
            : read.error
              ? "Current calibration unavailable."
              : "Checking current acceptance…"}
      </p>
      <Feedback error={read.error} />
    </>
  );
}
export function CalibrationSettings() {
  const rpc = useJudgeRpc();
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const load = useCallback(
    () => (run ? rpc.call("tests.get", { id: run }) : Promise.resolve(null)),
    [rpc, run],
  );
  const read = useRead(`calibration:${run}`, load);
  const action = useAction(read.refresh);
  const report = read.data;
  return (
    <Group title="Review and accept calibration">
      <p>
        Run explicit case tests with{" "}
        <code>bb judge test &lt;set-id&gt; --json</code>, then load its report
        here. Loading or accepting a report makes no provider request.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft === run) read.refresh();
          else setRun(draft);
          setAcknowledged(false);
        }}
      >
        <Field label="Case report ID">
          <Input
            required
            maxLength={128}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <Button type="submit">Load case report</Button>
      </form>
      {run && read.data === null && <p>No case report found.</p>}
      {report && (
        <>
          <AcceptedCalibration id={report.set.id} />
          <p>
            Set: {report.set.id} · {report.complete ? "complete" : "incomplete"}
            {report.stale ? " · stale" : ""}
          </p>
          <p>
            Set hash: <code>{report.set.hash}</code>
          </p>
          {report.variants.map((v) => (
            <div key={v.kind}>
              <p>
                {v.kind}: {v.counts.correct} correct, {v.counts.incorrect}{" "}
                incorrect, {v.counts.unavailable} unavailable.
              </p>
              {v.identities.map((m) => (
                <p key={m.fingerprint}>
                  {m.id}: {m.connection}/{m.model} ·{" "}
                  <code>{m.fingerprint}</code>
                </p>
              ))}
              <details>
                <summary>{v.kind} case outcomes</summary>
                {v.results.map((result) => (
                  <p key={result.index}>
                    Case {report.cases[result.index]?.id ?? result.index + 1}:{" "}
                    {result.status}. Expected{" "}
                    {JSON.stringify(report.cases[result.index]?.expect)};
                    observed {JSON.stringify(result.outcomes)}
                    {result.failure
                      ? `; ${result.failure.reason}/${result.failure.code}`
                      : ""}
                    .
                  </p>
                ))}
              </details>
            </div>
          ))}
          <p>{report.modelLabelLimitation}</p>
          <Field label="I reviewed the primary outcomes and mismatch counts; accept this evidence">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
          </Field>
          <Button
            type="button"
            disabled={
              action.pending ||
              !acknowledged ||
              !report.complete ||
              report.stale
            }
            onClick={() => {
              void action.act(
                () =>
                  rpc.call("calibration.accept", {
                    id: report.set.id,
                    run: report.id,
                  }),
                "Primary calibration accepted. This does not enable a binding or certify model correctness.",
              );
            }}
          >
            Accept primary calibration
          </Button>
          <small>
            Only exact complete current evidence can be accepted. Server
            validation rechecks set and model fingerprints. Comparison results
            are never chosen automatically.
          </small>
        </>
      )}
      <Feedback error={read.error ?? action.error} notice={action.notice} />
    </Group>
  );
}
