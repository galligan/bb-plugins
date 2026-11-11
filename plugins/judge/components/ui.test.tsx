import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { registerHooks } from "node:module";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  DocumentFragment: dom.window.DocumentFragment,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  // JSDOM does not perform layout; live host checks cover sizing. Radix's
  // form-control observer still needs its browser interface for behavior tests.
  ResizeObserver: class {
    observe() {
      /* No layout in JSDOM. */
    }
    unobserve() {
      /* No layout in JSDOM. */
    }
    disconnect() {
      /* No layout in JSDOM. */
    }
  },
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLElement.prototype.hasPointerCapture = function () {
  return false;
};
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : next(url, context);
  },
});
const { loadPluginApp, renderSlot } =
  await import("@get-bb/plugin-sdk/testing/app");
const { fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const { VerdictInfo, useVerdictRows } = await import("./verdicts.tsx");
const { ModelsSettings } = await import("./models-settings.tsx");
const { TriggerSettings } = await import("./trigger-settings.tsx");
const { CalibrationSettings } = await import("./policy-settings.tsx");
import type { ExperimentalThreadRowMetadataDataInput } from "@get-bb/plugin-sdk/app";
afterEach(() => cleanup());
const emptyRow = {
  threadId: "thread",
  badges: [],
  extraBadges: 0,
  publicationFailure: null,
};
const latest = {
  runId: "run",
  setId: "set",
  startedAt: 1000,
  status: "uncalibrated",
  code: null,
  models: [
    { id: "saved", model: "jev-test", providerModel: "recorded-version" },
  ],
};
test("frontend registrations include settings, independent Info and optional row metadata", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  assert.equal(app.settingsSections.length, 1);
  assert.equal(app.threadInfoRows.length, 1);
  assert.equal(app.threadRowMetadata.length, 1);
  css.deregister();
});
test("Info works without sidebar settings, shows sanitized status/model and clears on realtime/error", async () => {
  let value: unknown = { current: emptyRow, latest };
  const slot = renderSlot(
    { component: VerdictInfo },
    { threadId: "thread", projectId: "project", environment: null },
    { rpc: { "ui.thread": async () => value } },
  );
  await slot.findByText("uncalibrated");
  assert.ok(slot.getByText(/recorded-version/));
  assert.ok(slot.getByText("No current badges."));
  value = {
    current: { ...emptyRow, badges: [{ setId: "set", label: "Current" }] },
    latest: { ...latest, status: "current" },
  };
  await slot.behavior.emitRealtime("changed", {});
  await slot.findByText("Current");
  value = {
    current: {
      ...emptyRow,
      badges: [{ setId: "set", label: "FORGED", answers: "PRIVATE" }],
    },
    latest,
  };
  await slot.behavior.emitRealtime("changed", {});
  await slot.findByRole("alert");
  assert.equal(slot.queryByText("Current"), null);
  assert.equal(slot.queryByText("FORGED"), null);
  assert.ok(!slot.container.textContent?.includes("PRIVATE"));
  value = { current: emptyRow, latest: null };
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await slot.findByText("No recorded runs for this thread.");
  slot.lifecycle.unmount();
});
test("Info invalidation rejects a late obsolete response", async () => {
  let release: ((value: unknown) => void) | undefined;
  let first = true;
  const slot = renderSlot(
    { component: VerdictInfo },
    { threadId: "thread", projectId: "project", environment: null },
    {
      rpc: {
        "ui.thread": async () =>
          first
            ? ((first = false),
              new Promise((resolve) => {
                release = resolve;
              }))
            : { current: emptyRow, latest: null },
      },
    },
  );
  await waitFor(() => assert.ok(release));
  await slot.behavior.emitRealtime("changed", {});
  await slot.findByText("No recorded runs for this thread.");
  release!({
    current: { ...emptyRow, badges: [{ setId: "set", label: "OBSOLETE" }] },
    latest,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slot.queryByText("OBSOLETE"), null);
  slot.lifecycle.unmount();
});
function Rows({ threads }: ExperimentalThreadRowMetadataDataInput) {
  const data = useVerdictRows({ threads });
  return <div>{Object.keys(data ?? {}).length} loaded</div>;
}
const threads = Array.from({ length: 201 }, (_, i) => ({
  id: `thread${i}`,
})) as unknown as ExperimentalThreadRowMetadataDataInput["threads"];
test("optional badges do no reads by default; enabled rows batch in chunks <=200 and refresh", async () => {
  const calls: string[][] = [];
  const handler = async (value: unknown) => {
    const ids = (value as { threadIds: string[] }).threadIds;
    calls.push(ids);
    return { threads: ids.map((threadId) => ({ ...emptyRow, threadId })) };
  };
  const disabled = renderSlot(
    { component: Rows },
    { threads },
    { rpc: { "ui.badges": handler }, settings: {} },
  );
  await disabled.findByText("0 loaded");
  assert.equal(calls.length, 0);
  disabled.lifecycle.unmount();
  const enabled = renderSlot(
    { component: Rows },
    { threads },
    { rpc: { "ui.badges": handler }, settings: { showSidebarBadges: true } },
  );
  await enabled.findByText("201 loaded");
  assert.deepEqual(
    calls.map((c) => c.length),
    [200, 1],
  );
  await enabled.behavior.emitRealtime("changed", {});
  await waitFor(() => assert.equal(calls.length, 4));
  await enabled.findByText("201 loaded");
  enabled.lifecycle.unmount();
});
test("model save refreshes persisted policy without probes or trigger activation; validation errors are actionable", async () => {
  const models: {
    id: string;
    connection: string;
    model: string;
    allowPrivate: boolean;
    timeoutMs: number;
  }[] = [];
  let invalid = false;
  const slot = renderSlot(
    { component: ModelsSettings },
    {},
    {
      rpc: {
        "models.list": () => ({
          models,
          defaults: { defaultId: null, privateId: null },
          next: null,
        }),
        "models.add": (input: unknown) => {
          if (invalid)
            throw Object.assign(new Error("Input failed validation"), {
              code: "invalid",
            });
          models.push(input as (typeof models)[number]);
          return input;
        },
      },
    },
  );
  await slot.findByText("No models configured.");
  fireEvent.change(slot.getByLabelText("Model ID"), {
    target: { value: "saved" },
  });
  fireEvent.change(slot.getByLabelText("Provider model selector"), {
    target: { value: "jev-test" },
  });
  fireEvent.click(slot.getByText("Save model"));
  await waitFor(() => assert.equal(models.length, 1));
  assert.equal(models[0]?.allowPrivate, false);
  invalid = true;
  fireEvent.click(slot.getByText("Save model"));
  await slot.findByText(/Check the IDs/);
  assert.ok(
    !slot.inspection.rpcCalls.some((c) =>
      ["ask", "run", "test", "triggers.enable"].includes(c.method),
    ),
  );
  slot.lifecycle.unmount();
});
test("binding saves remain disabled and enabling requires separate acknowledged explicit click", async () => {
  const records: unknown[] = [];
  let toggles = 0;
  const binding = {
    definition: {
      schemaVersion: 1,
      id: "binding",
      setId: "set",
      event: "thread.idle",
      projects: "all",
      badges: {},
    },
    enabled: false,
    hash: "a".repeat(64),
    revision: "r",
  };
  const slot = renderSlot(
    { component: TriggerSettings },
    {},
    {
      rpc: {
        "triggers.list": () => ({ triggers: records, next: null }),
        "triggers.save": (input: unknown) => {
          assert.ok(!Object.hasOwn(input as object, "enabled"));
          records.push(binding);
          return binding;
        },
        "triggers.enable": () => {
          toggles++;
          binding.enabled = true;
          return binding;
        },
      },
    },
  );
  slot.container.querySelector("details")?.setAttribute("open", "");
  await slot.findByText("No event bindings configured.");
  fireEvent.change(slot.getByLabelText("Binding ID"), {
    target: { value: "binding" },
  });
  fireEvent.change(slot.getByLabelText("Saved set ID"), {
    target: { value: "set" },
  });
  fireEvent.click(slot.getByText("Save disabled binding"));
  await slot.findByText("Enable binding");
  const enable = slot.getByText("Enable binding") as HTMLButtonElement;
  assert.equal(enable.disabled, true);
  assert.equal(toggles, 0);
  fireEvent.click(slot.getByLabelText(/I understand enabling/));
  fireEvent.click(enable);
  await waitFor(() => assert.equal(toggles, 1));
  await slot.findByText("Disable binding");
  slot.lifecycle.unmount();
});
test("missing calibration reports and transport errors remain visible without accepting or inferring", async () => {
  const slot = renderSlot(
    { component: CalibrationSettings },
    {},
    { rpc: { "tests.get": () => null } },
  );
  fireEvent.change(slot.getByLabelText("Case report ID"), {
    target: { value: "missing" },
  });
  fireEvent.click(slot.getByText("Load case report"));
  await slot.findByText("No case report found.");
  assert.equal(slot.queryByText("Accept primary calibration"), null);
  assert.deepEqual(
    slot.inspection.rpcCalls.map((c) => c.method),
    ["tests.get"],
  );
  slot.lifecycle.unmount();
});

test("calibration review shows primary cases and needs acknowledgement before explicit acceptance", async () => {
  const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
  const { setupEvaluation, evaluationDefinition } =
    await import("../lib/evaluation-fixtures.ts");
  const { fixtureHostOptions } = await import("../lib/runner-fixtures.ts");
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  try {
    const def = evaluationDefinition();
    def.cases = def.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(def));
    const report = await h.api.evaluations.test({ id: "synthetic" });
    let accepted = false;
    const slot = renderSlot(
      { component: CalibrationSettings },
      {},
      {
        rpc: {
          "tests.get": () => report,
          "calibration.get": () => (accepted ? { testRunId: report.id } : null),
          "calibration.accept": (value: unknown) => {
            assert.deepEqual(value, { id: "synthetic", run: report.id });
            accepted = true;
            return { setId: "synthetic" };
          },
        },
      },
    );
    fireEvent.change(slot.getByLabelText("Case report ID"), {
      target: { value: report.id },
    });
    fireEvent.click(slot.getByText("Load case report"));
    const accept = (await slot.findByText(
      "Accept primary calibration",
    )) as HTMLButtonElement;
    assert.equal(accept.disabled, true);
    await slot.findByText("No current calibration acceptance.");
    assert.ok(slot.getByText(/Case positive: correct/));
    fireEvent.click(slot.getByLabelText(/I reviewed the primary/));
    fireEvent.click(accept);
    await waitFor(() => assert.equal(accepted, true));
    await slot.behavior.emitRealtime("changed", {});
    await slot.findByText(`Current acceptance: ${report.id}`);
    assert.ok(
      slot.inspection.rpcCalls.every(
        (call) =>
          !["ask", "run", "test", "triggers.enable"].includes(call.method),
      ),
    );
    slot.lifecycle.unmount();
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("unrelated thread events do not refetch Info, while matching/config changes clear and reread", async () => {
  let calls = 0;
  const slot = renderSlot(
    { component: VerdictInfo },
    { threadId: "thread", projectId: "project", environment: null },
    {
      rpc: {
        "ui.thread": () => {
          calls++;
          return { current: emptyRow, latest: null };
        },
      },
    },
  );
  await slot.findByText("No recorded runs for this thread.");
  assert.equal(calls, 1);
  await slot.behavior.emitRealtime("changed", {
    configuration: false,
    threadIds: ["other"],
  });
  assert.equal(calls, 1);
  await slot.behavior.emitRealtime("changed", {
    configuration: false,
    threadIds: ["thread"],
  });
  await waitFor(() => assert.equal(calls, 2));
  await slot.behavior.emitRealtime("changed", {
    configuration: true,
    threadIds: [],
  });
  await waitFor(() => assert.equal(calls, 3));
  slot.lifecycle.unmount();
});

test("actual backend refusals reach calibration, private-default and binding UI recovery paths", async () => {
  const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
  const { setupEvaluation, evaluationDefinition } =
    await import("../lib/evaluation-fixtures.ts");
  const { fixtureHostOptions } = await import("../lib/runner-fixtures.ts");
  const { DefaultSettings } = await import("./models-settings.tsx");
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  try {
    const def = evaluationDefinition();
    def.cases = def.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(def));
    const report = await h.api.evaluations.test({ id: "synthetic" });
    h.api.models.save({ ...h.repository.getModel("public")!, timeoutMs: 2500 });
    const calls = h.bodies.length;
    const defaultsBefore = h.repository.getDefaults();
    const call = (method: string) => (value: unknown) =>
      h.harness.behavior.callRpc(method, value);
    const calibration = renderSlot(
      { component: CalibrationSettings },
      {},
      {
        rpc: {
          "tests.get": call("tests.get"),
          "calibration.get": call("calibration.get"),
          "calibration.accept": call("calibration.accept"),
        },
      },
    );
    fireEvent.change(calibration.getByLabelText("Case report ID"), {
      target: { value: report.id },
    });
    fireEvent.click(calibration.getByText("Load case report"));
    await calibration.findByText("Accept primary calibration");
    fireEvent.click(calibration.getByLabelText(/I reviewed the primary/));
    fireEvent.click(calibration.getByText("Accept primary calibration"));
    await calibration.findByText(/fresh complete case report/);
    calibration.lifecycle.unmount();
    const defaults = renderSlot(
      { component: DefaultSettings },
      {},
      {
        rpc: {
          "models.list": call("models.list"),
          "models.default": call("models.default"),
        },
      },
    );
    await waitFor(() =>
      assert.equal(
        (
          defaults.getByRole("combobox", {
            name: "Default model",
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    fireEvent.keyDown(
      defaults.getByRole("combobox", { name: "Default model" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await defaults.findByRole("option", { name: "public" }));
    fireEvent.click(defaults.getByLabelText("Set private fallback"));
    fireEvent.click(defaults.getByText("Save default"));
    await defaults.findByText(/explicitly permits private data/);
    defaults.lifecycle.unmount();
    const binding = renderSlot(
      { component: TriggerSettings },
      {},
      {
        rpc: {
          "triggers.list": call("triggers.list"),
          "triggers.save": call("triggers.save"),
        },
      },
    );
    await binding.findByText("No event bindings configured.");
    fireEvent.change(binding.getByLabelText("Binding ID"), {
      target: { value: "binding" },
    });
    fireEvent.change(binding.getByLabelText("Saved set ID"), {
      target: { value: "missing" },
    });
    fireEvent.click(binding.getByText("Save disabled binding"));
    await binding.findByText(/Choose an existing saved set/);
    fireEvent.change(binding.getByLabelText("Saved set ID"), {
      target: { value: "synthetic" },
    });
    fireEvent.change(
      binding.getByLabelText("Badge labels: JSON outcome-to-label map"),
      { target: { value: '{"unknown":"Label"}' } },
    );
    fireEvent.click(binding.getByText("Save disabled binding"));
    await binding.findByText(/saved set's final outcomes/);
    binding.lifecycle.unmount();
    assert.equal(h.bodies.length, calls);
    assert.deepEqual(h.repository.getDefaults(), defaultsBefore);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    assert.equal(h.repository.triggers.get("binding"), null);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("project and case-report Load controls retry an unchanged ID after a failed read", async () => {
  const { ProjectSettings } = await import("./policy-settings.tsx");
  for (const kind of ["project", "report"] as const) {
    let calls = 0;
    const load = () => {
      calls++;
      if (calls === 1) throw new Error("temporary_read_failure");
      return kind === "project" ? { projectId: "same", enabled: true } : null;
    };
    const slot =
      kind === "project"
        ? renderSlot(
            { component: ProjectSettings },
            {},
            { rpc: { "projects.get": load } },
          )
        : renderSlot(
            { component: CalibrationSettings },
            {},
            { rpc: { "tests.get": load } },
          );
    const label = kind === "project" ? "Project ID" : "Case report ID";
    const button =
      kind === "project" ? "Load project policy" : "Load case report";
    fireEvent.change(slot.getByLabelText(label), { target: { value: "same" } });
    fireEvent.click(slot.getByText(button));
    slot.container.querySelector("details")?.setAttribute("open", "");
    await slot.findByRole("alert");
    assert.equal(calls, 1);
    fireEvent.click(slot.getByText(button));
    await slot.findByText(
      kind === "project" ? /same: Judge allowed/ : "No case report found.",
    );
    assert.equal(calls, 2);
    assert.equal(slot.queryByRole("alert"), null);
    slot.lifecycle.unmount();
  }
});

test("BB registry connection select opens by keyboard and changes the model hint", async () => {
  const { act } = await import("@testing-library/react");
  const slot = renderSlot(
    { component: ModelsSettings },
    {},
    {
      rpc: {
        "models.list": () => ({
          models: [],
          defaults: { defaultId: null, privateId: null },
          next: null,
        }),
      },
    },
  );
  await slot.findByText("No models configured.");
  const trigger = slot.getByRole("combobox", { name: "Connection" });
  await act(async () => {
    trigger.focus();
  });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const second = await slot.findByRole("option", {
    name: "Cloudflare Workers AI",
  });
  fireEvent.click(second);
  await waitFor(() =>
    assert.ok(trigger.textContent?.includes("Cloudflare Workers AI")),
  );
  assert.ok(slot.getByPlaceholderText("clef or clef-flash"));
  assert.ok(
    slot.inspection.rpcCalls.every((call) => call.method === "models.list"),
  );
  slot.lifecycle.unmount();
});

test("compact choices display their initial selected label and retain changed labels after closing", async () => {
  const { createElement, useState } = await import("react");
  const { Choice } = await import("./controls.tsx");
  const { CompactViewportOverrideProvider } =
    await import("./ui/hooks/use-compact-viewport.tsx");
  function CompactChoice() {
    const [value, setValue] = useState("typesafe");
    return createElement(CompactViewportOverrideProvider, {
      isCompactViewport: true,
      children: createElement(Choice, {
        label: "Fixture connection",
        value,
        onChange: setValue,
        options: [
          { value: "typesafe", label: "Jev / TypeSafe" },
          { value: "cloudflare", label: "Cloudflare Workers AI" },
        ],
      }),
    });
  }
  const slot = renderSlot({ component: CompactChoice }, {});
  const trigger = slot.getByRole("combobox", { name: "Fixture connection" });
  assert.match(trigger.textContent ?? "", /Jev \/ TypeSafe/);
  fireEvent.click(trigger);
  fireEvent.click(
    await slot.findByRole("option", { name: "Cloudflare Workers AI" }),
  );
  await waitFor(() =>
    assert.match(trigger.textContent ?? "", /Cloudflare Workers AI/),
  );
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  fireEvent.click(trigger);
  fireEvent.click(await slot.findByRole("option", { name: "Jev / TypeSafe" }));
  await waitFor(() =>
    assert.match(trigger.textContent ?? "", /Jev \/ TypeSafe/),
  );
  slot.lifecycle.unmount();
});

test("first-load settings failures retain visible read-only retry controls", async () => {
  const { DefaultSettings } = await import("./models-settings.tsx");
  for (const kind of ["models", "defaults", "bindings"] as const) {
    let calls = 0;
    const load = () => {
      calls++;
      if (calls === 1) throw new Error("read_failed");
      return kind === "bindings"
        ? { triggers: [], next: null }
        : {
            models: [],
            defaults: { defaultId: null, privateId: null },
            next: null,
          };
    };
    const component =
      kind === "models"
        ? ModelsSettings
        : kind === "defaults"
          ? DefaultSettings
          : TriggerSettings;
    const slot = renderSlot(
      { component },
      {},
      {
        rpc: { [kind === "bindings" ? "triggers.list" : "models.list"]: load },
      },
    );
    slot.container.querySelector("details")?.setAttribute("open", "");
    await slot.findByRole("alert");
    fireEvent.click(slot.getByText(`Refresh ${kind}`));
    await slot.findByText(
      kind === "bindings"
        ? "No event bindings configured."
        : kind === "models"
          ? "No models configured."
          : /Current default: none/,
    );
    assert.equal(calls, 2);
    assert.equal(slot.queryByRole("alert"), null);
    slot.lifecycle.unmount();
  }
});
test("connection readiness failure can be retried without a synthetic probe", async () => {
  let calls = 0;
  const slot = renderSlot(
    { component: ModelsSettings },
    {},
    {
      rpc: {
        "models.list": () => ({
          models: [
            {
              id: "saved",
              connection: "typesafe",
              model: "jev-test",
              allowPrivate: false,
              timeoutMs: 2000,
            },
          ],
          defaults: { defaultId: null, privateId: null },
          next: null,
        }),
        "models.check": (value: unknown) => {
          assert.deepEqual(value, { id: "saved", probe: false });
          calls++;
          if (calls === 1) throw new Error("read_failed");
          return {
            status: "configured",
            nextAction: "Synthetic readiness fixture only",
          };
        },
      },
    },
  );
  const saved = await slot.findByRole("combobox", { name: "Saved model" });
  fireEvent.keyDown(saved, { key: "ArrowDown" });
  fireEvent.click(
    await slot.findByRole("option", { name: /saved · typesafe\/jev-test/ }),
  );
  await slot.findByRole("alert");
  fireEvent.click(slot.getByText("Refresh connection readiness"));
  await slot.findByText(/readiness \(saved\): configured/);
  assert.equal(calls, 2);
  assert.equal(slot.queryByRole("alert"), null);
  assert.ok(
    slot.inspection.rpcCalls.every((call) =>
      ["models.list", "models.check"].includes(call.method),
    ),
  );
  slot.lifecycle.unmount();
});
