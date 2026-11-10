import { useCallback, useState } from "react";
import type { ModelConfig } from "../lib/contracts.ts";
import { useJudgeRpc, useRead, useAction } from "./hooks.ts";
import { Group, Field, Feedback } from "./controls.tsx";
export function ModelsSettings() {
  const rpc = useJudgeRpc();
  const [after, setAfter] = useState<string>();
  const load = useCallback(
    () => rpc.call("models.list", { limit: 20, ...(after ? { after } : {}) }),
    [rpc, after],
  );
  const read = useRead(`models:${after ?? ""}`, load);
  const action = useAction(read.refresh);
  const [selected, setSelected] = useState<ModelConfig>();
  const [id, setId] = useState("");
  const [connection, setConnection] =
    useState<ModelConfig["connection"]>("typesafe");
  const [model, setModel] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [timeoutMs, setTimeout] = useState(2000);
  const readinessLoad = useCallback(
    () =>
      selected
        ? rpc.call("models.check", { id: selected.id, probe: false })
        : Promise.resolve(null),
    [rpc, selected],
  );
  const readiness = useRead(`ready:${selected?.id ?? ""}`, readinessLoad);
  function edit(value?: ModelConfig) {
    setSelected(value);
    setId(value?.id ?? "");
    setConnection(value?.connection ?? "typesafe");
    setModel(value?.model ?? "");
    setAllowPrivate(value?.allowPrivate ?? false);
    setTimeout(value?.timeoutMs ?? 2000);
  }
  return (
    <Group title="Models and private-data policy">
      <p>
        Saving a model never runs inference or enables a binding. Allow private
        data only for a connection you explicitly trust.
      </p>
      <Feedback error={read.error ?? action.error} notice={action.notice} />
      {!read.data ? (
        !read.error && <p>Loading models…</p>
      ) : (
        <>
          {read.data.models.length === 0 && <p>No models configured.</p>}
          <div className="judge-actions">
            {read.data.models.map((m) => (
              <button type="button" key={m.id} onClick={() => edit(m)}>
                {m.id} · {m.connection}/{m.model} ·{" "}
                {m.allowPrivate ? "private allowed" : "public only"}
              </button>
            ))}
          </div>
          <p>
            Default: {read.data.defaults.defaultId ?? "none"}; private fallback:{" "}
            {read.data.defaults.privateId ?? "none"}.
          </p>
          <div className="judge-actions">
            <button
              type="button"
              onClick={() => setAfter(undefined)}
              disabled={!after}
            >
              First models
            </button>
            <button
              type="button"
              onClick={() => setAfter(read.data?.next ?? undefined)}
              disabled={!read.data.next}
            >
              Next models
            </button>
            <button type="button" onClick={read.refresh}>
              Refresh models
            </button>
          </div>
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.act(
            () =>
              rpc.call("models.add", {
                ...selected,
                id,
                connection,
                model,
                allowPrivate,
                timeoutMs,
              }),
            "Model saved; calibration retired.",
          );
        }}
      >
        <fieldset disabled={action.pending}>
          <Field label="Model ID">
            <input
              value={id}
              required
              maxLength={128}
              onChange={(e) => setId(e.target.value)}
            />
          </Field>
          <Field label="Connection">
            <select
              value={connection}
              onChange={(e) =>
                setConnection(e.target.value as ModelConfig["connection"])
              }
            >
              <option value="typesafe">Jev / TypeSafe</option>
              <option value="cloudflare">Cloudflare Workers AI</option>
              <option value="custom">Custom System One</option>
            </select>
          </Field>
          <Field label="Provider model selector">
            <input
              value={model}
              required
              maxLength={256}
              placeholder={
                connection === "cloudflare"
                  ? "clef or clef-flash"
                  : "Exact provider model version"
              }
              onChange={(e) => setModel(e.target.value)}
            />
          </Field>
          <Field label="Timeout (milliseconds)">
            <input
              type="number"
              min={1}
              max={30000}
              value={timeoutMs}
              onChange={(e) => setTimeout(e.target.valueAsNumber)}
            />
          </Field>
          <Field label="Allow private data">
            <input
              type="checkbox"
              checked={allowPrivate}
              onChange={(e) => setAllowPrivate(e.target.checked)}
            />
          </Field>
          <div className="judge-actions">
            <button type="submit">Save model</button>
            <button type="button" onClick={() => edit()}>
              New model
            </button>
          </div>
        </fieldset>
      </form>
      {selected && (
        <div>
          <p>
            Saved connection readiness ({selected.id}):{" "}
            {readiness.data?.status ?? "checking"}.
          </p>
          {readiness.data && <p>{readiness.data.nextAction}</p>}
          <Feedback error={readiness.error} />
          <small>
            Readiness checks do not call the provider. Use an explicit CLI
            synthetic probe when wanted; configured does not mean live-verified.
          </small>
        </div>
      )}
    </Group>
  );
}
export function DefaultSettings() {
  const rpc = useJudgeRpc();
  const load = useCallback(() => rpc.call("models.list", { limit: 1 }), [rpc]);
  const read = useRead("defaults", load);
  const action = useAction(read.refresh);
  const [id, setId] = useState("");
  const [privateDefault, setPrivate] = useState(false);
  return (
    <Group title="Model defaults">
      <p>
        Current default: {read.data?.defaults.defaultId ?? "none"}; private
        fallback: {read.data?.defaults.privateId ?? "none"}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.act(
            () =>
              rpc.call("models.default", {
                id: id || null,
                private: privateDefault,
              }),
            "Default saved; calibration retired.",
          );
        }}
      >
        <fieldset disabled={action.pending}>
          <Field label="Saved model ID (empty clears)">
            <input
              value={id}
              maxLength={128}
              onChange={(e) => setId(e.target.value)}
            />
          </Field>
          <Field label="Set private fallback">
            <input
              type="checkbox"
              checked={privateDefault}
              onChange={(e) => setPrivate(e.target.checked)}
            />
          </Field>
          <button type="submit">Save default</button>
        </fieldset>
      </form>
      <Feedback error={read.error ?? action.error} notice={action.notice} />
    </Group>
  );
}
