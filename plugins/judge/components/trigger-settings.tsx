import { Button, Input, Checkbox, Textarea, Choice } from "./controls.tsx";
import { useCallback, useState } from "react";
import type { TriggerRecord } from "../lib/triggers-contract.ts";
import { useJudgeRpc, useRead, useAction } from "./hooks.ts";
import { Group, Field, Feedback } from "./controls.tsx";
export function TriggerSettings() {
  const rpc = useJudgeRpc();
  const [after, setAfter] = useState<string>();
  const load = useCallback(
    () => rpc.call("triggers.list", { limit: 20, ...(after ? { after } : {}) }),
    [rpc, after],
  );
  const read = useRead(`triggers:${after ?? ""}`, load);
  const action = useAction(read.refresh);
  const [id, setBindingId] = useState("");
  const [setId, setSetId] = useState("");
  const [event, setEvent] = useState<"thread.idle" | "turn.failed">(
    "thread.idle",
  );
  const [projects, setProjects] = useState("all");
  const [badges, setBadges] = useState("{}");
  const [confirmEnable, setConfirmEnable] = useState(false);
  function edit(value?: TriggerRecord) {
    setBindingId(value?.definition.id ?? "");
    setSetId(value?.definition.setId ?? "");
    setEvent(value?.definition.event ?? "thread.idle");
    setProjects(
      value?.definition.projects === "all" || !value
        ? "all"
        : JSON.stringify(value.definition.projects),
    );
    setBadges(JSON.stringify(value?.definition.badges ?? {}));
  }
  return (
    <Group title="Event bindings">
      <p>
        New and edited bindings are disabled. Saving settings never activates a
        binding. Enabling may make paid calls on matching events, subject to
        existing private-data policy. Only complete, current, calibrated results
        publish badges.
      </p>
      <Field label="I understand enabling bindings can make paid requests">
        <Checkbox
          checked={confirmEnable}
          onCheckedChange={(value) => setConfirmEnable(value === true)}
        />
      </Field>
      <Feedback error={read.error ?? action.error} notice={action.notice} />
      {!read.data ? (
        !read.error && <p>Loading bindings…</p>
      ) : (
        <>
          {read.data.triggers.length === 0 && (
            <p>No event bindings configured.</p>
          )}
          {read.data.triggers.map((t) => (
            <div key={t.definition.id}>
              <p>
                <strong>{t.definition.id}</strong> · {t.definition.setId} ·{" "}
                {t.definition.event} · {t.enabled ? "Enabled" : "Disabled"}
              </p>
              <div className="judge-actions">
                <Button
                  type="button"
                  disabled={action.pending}
                  onClick={() => edit(t)}
                >
                  Edit {t.definition.id}
                </Button>
                <Button
                  type="button"
                  disabled={action.pending || (!t.enabled && !confirmEnable)}
                  onClick={() => {
                    void action.act(
                      () =>
                        rpc.call("triggers.enable", {
                          id: t.definition.id,
                          enabled: !t.enabled,
                        }),
                      t.enabled
                        ? "Binding disabled."
                        : "Binding explicitly enabled.",
                    );
                  }}
                >
                  {t.enabled ? "Disable" : "Enable"} {t.definition.id}
                </Button>
                <Button
                  type="button"
                  disabled={action.pending}
                  onClick={() => {
                    void action.act(
                      () =>
                        rpc.call("triggers.remove", { id: t.definition.id }),
                      "Binding removed.",
                    );
                  }}
                >
                  Remove {t.definition.id}
                </Button>
              </div>
            </div>
          ))}
          <div className="judge-actions">
            <Button
              type="button"
              disabled={!after}
              onClick={() => setAfter(undefined)}
            >
              First bindings
            </Button>
            <Button
              type="button"
              disabled={!read.data.next}
              onClick={() => setAfter(read.data?.next ?? undefined)}
            >
              Next bindings
            </Button>
          </div>
        </>
      )}
      <Button type="button" onClick={read.refresh}>
        Refresh bindings
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.act(
            async () =>
              rpc.call("triggers.save", {
                schemaVersion: 1,
                id,
                setId,
                event,
                projects: projects === "all" ? "all" : JSON.parse(projects),
                badges: JSON.parse(badges),
              }),
            "Binding saved disabled. Enable separately when ready.",
          );
        }}
      >
        <fieldset disabled={action.pending}>
          <Field label="Binding ID">
            <Input
              value={id}
              required
              maxLength={128}
              onChange={(e) => setBindingId(e.target.value)}
            />
          </Field>
          <Field label="Saved set ID">
            <Input
              value={setId}
              required
              maxLength={128}
              onChange={(e) => setSetId(e.target.value)}
            />
          </Field>
          <Choice
            label="Event"
            value={event}
            onChange={(value) => setEvent(value as typeof event)}
            options={[
              { value: "thread.idle", label: "Thread idle" },
              { value: "turn.failed", label: "Turn failed" },
            ]}
          />
          <Field label="Projects: all or JSON ID array">
            <Input
              value={projects}
              maxLength={14000}
              onChange={(e) => setProjects(e.target.value)}
            />
          </Field>
          <Field label="Badge labels: JSON outcome-to-label map">
            <Textarea
              value={badges}
              maxLength={20000}
              onChange={(e) => setBadges(e.target.value)}
            />
          </Field>
          <small>
            Use an empty map for record-only execution. No send, notification or
            other action is available.
          </small>
          <div className="judge-actions">
            <Button type="submit">Save disabled binding</Button>
            <Button type="button" onClick={() => edit()}>
              New binding
            </Button>
          </div>
        </fieldset>
      </form>
    </Group>
  );
}
