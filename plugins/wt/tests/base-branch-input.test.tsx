// The "Branch from:" provider input through the SDK frontend harness.
import { expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";

type Props = PluginEnvironmentProviderInputsProps;

async function input(
  props: Partial<Props>,
  defaultBase: () => { base: string | null } = () => ({ base: "main" }),
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const onChange = vi.fn<Props["onChange"]>();
  const full: Props = {
    projectId: "proj_acme",
    target: { kind: "existing-host", hostId: "host_mac" },
    value: null,
    onChange,
    ...props,
  };
  const slot = renderSlot(app.environmentProviderInputs[0]!, full, {
    rpc: { defaultBase },
  });
  return { slot, onChange };
}

test("with nothing picked, it asks the machine for its default base and fills it in", async () => {
  const { slot, onChange } = await input({});
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      status: "ready",
      value: { base: "main" },
    }),
  );
  expect(slot.inspection.rpcCalls).toEqual([
    {
      method: "defaultBase",
      input: { projectId: "proj_acme", hostId: "host_mac" },
    },
  ]);
});

test("it does not ask when a base is already picked, or when the project or machine is unknown", async () => {
  for (const props of [
    { value: { base: "release/1" } },
    { projectId: null },
    { target: { kind: "new-host" } },
  ] satisfies Partial<Props>[]) {
    const { slot, onChange } = await input(props);
    await Promise.resolve();
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    slot.lifecycle.unmount();
  }
});

test("a machine with no default, or a failed lookup, leaves the inputs empty", async () => {
  const none = await input({}, () => ({ base: null }));
  await waitFor(() => expect(none.slot.inspection.rpcCalls).toHaveLength(1));
  none.slot.lifecycle.unmount();
  expect(none.onChange).not.toHaveBeenCalled();

  const failed = await input({}, () => {
    throw new Error("host unreachable");
  });
  await waitFor(() => expect(failed.slot.inspection.rpcCalls).toHaveLength(1));
  failed.slot.lifecycle.unmount();
  expect(failed.onChange).not.toHaveBeenCalled();
});
