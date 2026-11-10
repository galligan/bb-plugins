import { Button, Input, Switch, Checkbox, Choice } from "./controls.tsx";
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
    <Group
      title="Models"
      description="Configure the models Judge can use. Only allow private data for a connection you trust."
    >
      <Feedback error={read.error ?? action.error} notice={action.notice} />
      {!read.data ? (
        !read.error && <p>Loading models…</p>
      ) : (
        <>
          {read.data.models.length === 0 && <p>No models configured.</p>}
          <Choice
            label="Saved model"
            value={selected ? `model:${selected.id}` : "new"}
            disabled={action.pending}
            onChange={(value) =>
              edit(read.data?.models.find((m) => `model:${m.id}` === value))
            }
            options={[
              { value: "new", label: "New model" },
              ...read.data.models.map((m) => ({
                value: `model:${m.id}`,
                label: `${m.id} · ${m.connection}/${m.model} · ${m.allowPrivate ? "private allowed" : "public only"}`,
              })),
            ]}
          />
          <p>
            Default: {read.data.defaults.defaultId ?? "none"}; private fallback:{" "}
            {read.data.defaults.privateId ?? "none"}.
          </p>
          {(after || read.data.next) && (
            <div className="judge-actions">
              <Button
                type="button"
                onClick={() => setAfter(undefined)}
                disabled={!after}
              >
                First models
              </Button>
              <Button
                type="button"
                onClick={() => setAfter(read.data?.next ?? undefined)}
                disabled={!read.data.next}
              >
                Next models
              </Button>
            </div>
          )}
        </>
      )}
      <Button type="button" onClick={read.refresh}>
        Refresh models
      </Button>
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
            <Input
              value={id}
              required
              maxLength={128}
              onChange={(e) => setId(e.target.value)}
            />
          </Field>
          <Choice
            disabled={action.pending}
            label="Connection"
            value={connection}
            onChange={(value) =>
              setConnection(value as ModelConfig["connection"])
            }
            options={[
              { value: "typesafe", label: "Jev / TypeSafe" },
              { value: "cloudflare", label: "Cloudflare Workers AI" },
              { value: "custom", label: "Custom System One" },
            ]}
          />
          <Field label="Provider model selector">
            <Input
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
            <Input
              type="number"
              min={1}
              max={30000}
              value={timeoutMs}
              onChange={(e) => setTimeout(e.target.valueAsNumber)}
            />
          </Field>
          <Field
            label="Allow private data"
            description="Permit this model to receive private source content."
          >
            <Switch checked={allowPrivate} onCheckedChange={setAllowPrivate} />
          </Field>
          <div className="judge-actions">
            <Button type="submit" variant="default">
              {action.pending ? "Saving…" : "Save model"}
            </Button>
            <Button type="button" onClick={() => edit()}>
              New model
            </Button>
          </div>
        </fieldset>
      </form>
      {selected && (
        <div>
          <p>
            Saved connection readiness ({selected.id}):{" "}
            {readiness.error
              ? "unavailable"
              : (readiness.data?.status ?? "checking")}
            .
          </p>
          {readiness.data && <p>{readiness.data.nextAction}</p>}
          <Feedback error={readiness.error} />
          <Button type="button" onClick={readiness.refresh}>
            Refresh connection readiness
          </Button>
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
  const [after, setAfter] = useState<string>();
  const load = useCallback(
    () => rpc.call("models.list", { limit: 100, ...(after ? { after } : {}) }),
    [rpc, after],
  );
  const read = useRead("defaults", load);
  const action = useAction(read.refresh);
  const [id, setId] = useState("");
  const [privateDefault, setPrivate] = useState(false);
  return (
    <Group title="Model defaults">
      {read.data ? (
        <p>
          Current default: {read.data.defaults.defaultId ?? "none"}; private
          fallback: {read.data.defaults.privateId ?? "none"}.
        </p>
      ) : (
        <p>
          {read.error
            ? "Model defaults unavailable."
            : "Loading model defaults…"}
        </p>
      )}
      <Button type="button" onClick={read.refresh}>
        Refresh defaults
      </Button>
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
          <Choice
            label="Default model"
            value={id ? `model:${id}` : "clear"}
            disabled={action.pending || !read.data}
            onChange={(value) => setId(value === "clear" ? "" : value.slice(6))}
            options={[
              { value: "clear", label: "None" },
              ...(read.data?.models ?? []).map((m) => ({
                value: `model:${m.id}`,
                label: m.id,
              })),
            ]}
          />
          {(after || read.data?.next) && (
            <div className="judge-actions">
              <Button
                type="button"
                disabled={!after}
                onClick={() => {
                  setId("");
                  setAfter(undefined);
                }}
              >
                First models
              </Button>
              <Button
                type="button"
                disabled={!read.data?.next}
                onClick={() => {
                  setId("");
                  setAfter(read.data?.next ?? undefined);
                }}
              >
                Next models
              </Button>
            </div>
          )}
          <Field label="Set private fallback">
            <Checkbox
              checked={privateDefault}
              onCheckedChange={(value) => setPrivate(value === true)}
            />
          </Field>
          <Button type="submit">Save default</Button>
        </fieldset>
      </form>
      <Feedback error={read.error ?? action.error} notice={action.notice} />
    </Group>
  );
}
