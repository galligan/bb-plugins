// The "Branch from:" provider input through the SDK frontend harness.
import { expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";

type Props = PluginEnvironmentProviderInputsProps;

type Base = { base: string | null };
type Settle = {
  resolve: (value: Base) => void;
  reject: (reason: Error) => void;
};

async function input(
  props: Partial<Props>,
  defaultBase: () => Base | Promise<Base> = () => ({ base: "main" }),
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
  // Hold each reply, then let it and its continuations settle while the input
  // is still mounted. Unmounting first would hide a wrong onChange.
  for (const reply of [
    (settle: Settle) => settle.resolve({ base: null }),
    (settle: Settle) => settle.reject(new Error("host unreachable")),
  ]) {
    let settle!: Settle;
    const { slot, onChange } = await input(
      {},
      () =>
        new Promise<{ base: string | null }>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    reply(settle);
    await new Promise((done) => setTimeout(done, 0));
    expect(onChange).not.toHaveBeenCalled();
    slot.lifecycle.unmount();
  }
});
