// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useComposer,
  type ComposerSelection,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useConversationOwner } from "../lib/ui/use-owner.ts";

// Capability experiment only: never registered by app.tsx. The public harness
// merges picker fields; it does not resolve catalogs, permissions or handoffs.
const candidate = { providerId: "fixture-provider", model: "fixture-model-b" };
const owner = { botId: "bot_fixture", name: "Bob", role: "main" as const };
const selection: ComposerSelection = {
  providerId: candidate.providerId,
  model: "fixture-model-a",
  reasoningLevel: "high",
  serviceTier: "default",
  permissionMode: "accept-edits",
};
const draft = {
  text: "@Bob keep this unsent draft",
  mentions: [
    {
      kind: "thread" as const,
      label: "Bob",
      threadId: "thr_reference",
      from: 0,
      to: 4,
    },
  ],
  attachments: [
    {
      type: "localFile" as const,
      path: "/tmp/synthetic-composer-fixture.txt",
      name: "synthetic-composer-fixture.txt",
    },
  ],
};
afterEach(cleanup);

function SelectionExperiment({
  providerId = candidate.providerId,
}: {
  providerId?: string;
}) {
  const composer = useComposer();
  const { owner: currentOwner, visible } = useConversationOwner(
    composer.scope.kind === "thread" ? composer.scope.threadId : null,
  );
  const [settled, setSettled] = useState(false);
  if (!currentOwner || !visible || composer.scope.kind !== "thread")
    return null;
  const sameProvider = composer.selection?.providerId === providerId;
  return (
    <>
      <button
        type="button"
        disabled={!sameProvider || composer.isRunning || composer.isSubmitting}
        onClick={async () => {
          await composer.setSelection({ model: candidate.model });
          setSettled(true);
        }}
      >
        Apply fixture model
      </button>
      {!sameProvider && (
        <p>Provider changes are excluded from this experiment.</p>
      )}
      {settled && <output>Harness selection settled</output>}
    </>
  );
}

async function fixture(
  options: {
    scope?: PluginComposerScope;
    providerId?: string;
    running?: boolean;
    submitting?: boolean;
    owned?: boolean;
  } = {},
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const Settings = app.composerCustomizations[0]!.actions![0]!.component;
  function Composition() {
    return (
      <>
        <Settings />
        <SelectionExperiment providerId={options.providerId} />
      </>
    );
  }
  const slot = renderSlot(
    { component: Composition },
    {},
    {
      context: { threadId: "thr_ambient_foreign", projectId: "proj_ambient" },
      composer: {
        ...draft,
        scope: options.scope ?? { kind: "thread", threadId: "thr_owned" },
        selection,
        isRunning: options.running ?? false,
        isSubmitting: options.submitting ?? false,
      },
      rpc: {
        ownership: (input) =>
          Object.fromEntries(
            (input as { keys: string[] }).keys.map((key) => [
              key,
              key === "thr_owned" && options.owned !== false ? owner : null,
            ]),
          ),
      },
    },
  );
  return { slot, app };
}

function noDispatch(slot: Awaited<ReturnType<typeof fixture>>["slot"]) {
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(slot.inspection.composer.inputLockCalls).toEqual([]);
  expect(slot.inspection.composer.textEffectCalls).toEqual([]);
  expect(slot.inspection.composer.focusCount).toBe(0);
  expect(slot.inspection.sdkCalls).toEqual([]);
  expect(
    slot.inspection.rpcCalls.every((call) => call.method === "ownership"),
  ).toBe(true);
}

test("a deliberate same-provider harness selection coexists with the actual Bots action and preserves the complete draft and omitted picker fields", async () => {
  const { slot, app } = await fixture();
  expect(app.composerCustomizations).toHaveLength(1);
  expect(app.composerCustomizations[0]?.id).toBe("bot-settings");
  await slot.findByRole("button", { name: "Bot settings for @Bob" });
  expect(slot.inspection.composer.selections).toEqual([]);
  const reads = slot.inspection.rpcCalls.filter(
    (call) => call.method === "ownership",
  );
  expect(reads).toHaveLength(1);
  expect(reads[0]?.input).toEqual({ keys: ["thr_owned"] });
  await userEvent.click(
    slot.getByRole("button", { name: "Bot settings for @Bob" }),
  );
  expect(slot.inspection.composer.selections).toEqual([]);
  await userEvent.click(
    slot.getByRole("button", { name: "Apply fixture model" }),
  );
  await slot.findByText("Harness selection settled");
  expect(slot.inspection.composer.selections).toEqual([
    { model: candidate.model },
  ]);
  expect(slot.inspection.composer.selection).toEqual({
    ...selection,
    model: candidate.model,
  });
  expect(slot.inspection.composer.draft).toEqual(draft);
  noDispatch(slot);
  const calls = slot.inspection.rpcCalls.length;
  slot.lifecycle.unmount();
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(slot.inspection.rpcCalls).toHaveLength(calls);
  noDispatch(slot);
});

test("cross-provider choices are refused by the experiment rather than assuming a harmless model-only change", async () => {
  const { slot } = await fixture({ providerId: "different-fixture-provider" });
  await slot.findByText(/Provider changes are excluded/);
  await userEvent.click(
    slot.getByRole("button", { name: "Apply fixture model" }),
  );
  expect(slot.inspection.composer.selections).toEqual([]);
  expect(slot.inspection.composer.selection).toEqual(selection);
  expect(slot.inspection.composer.draft).toEqual(draft);
  noDispatch(slot);
});

test("a thread scope alone does not authorize the probe when persisted ownership is absent", async () => {
  const { slot } = await fixture({ owned: false });
  await slot.behavior.experimental_invalidateRpc(["bots"]);
  expect(
    slot.queryByRole("button", { name: "Apply fixture model" }),
  ).toBeNull();
  expect(
    slot.queryByRole("button", { name: "Bot settings for @Bob" }),
  ).toBeNull();
  expect(slot.inspection.composer.selections).toEqual([]);
  expect(slot.inspection.composer.draft).toEqual(draft);
  noDispatch(slot);
});

test.each([
  { kind: "new-thread", projectId: "proj_fixture" },
  {
    kind: "queued-message",
    threadId: "thr_owned",
    queuedMessageId: "queue_fixture",
  },
  { kind: "thread", threadId: "thr_foreign" },
] satisfies PluginComposerScope[])(
  "the experiment has no setter control in scope $kind/$threadId",
  async (scope) => {
    const { slot } = await fixture({ scope });
    await waitFor(() =>
      expect(
        slot.queryByRole("button", { name: "Apply fixture model" }),
      ).toBeNull(),
    );
    expect(
      slot.queryByRole("button", { name: "Bot settings for @Bob" }),
    ).toBeNull();
    expect(slot.inspection.composer.selections).toEqual([]);
    expect(slot.inspection.composer.draft).toEqual(draft);
    noDispatch(slot);
  },
);

test.each(["running", "submitting"] as const)(
  "the bounded experiment stays inactive while %s without blocking access to Bot settings",
  async (state) => {
    const { slot } = await fixture({ [state]: true });
    await slot.findByRole("button", { name: "Bot settings for @Bob" });
    expect(
      slot
        .getByRole("button", { name: "Apply fixture model" })
        .matches(":disabled"),
    ).toBe(true);
    await userEvent.click(
      slot.getByRole("button", { name: "Bot settings for @Bob" }),
    );
    expect(slot.inspection.navigateCalls).toHaveLength(1);
    expect(slot.inspection.composer.selections).toEqual([]);
    noDispatch(slot);
  },
);
