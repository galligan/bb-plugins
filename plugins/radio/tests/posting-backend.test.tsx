import { it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import radio from "../server.ts";
import { resultSchema } from "../lib/surface-contract.ts";
import {
  ActingContext,
  identitySchema,
} from "../components/radio/acting-context.ts";
import { PostingComposer } from "../components/radio/posting-composer.tsx";

it("recognizes actual backend send/replay envelopes and preserves exactly one send after a lost response", async () => {
  sessionStorage.clear();
  const host = createFakePluginHost({
    pluginId: "radio",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "proj_posting",
            title: "Posting test",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Posting project",
          kind: "standard",
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          gitRemoteUrl: null,
        }),
      },
    },
  });
  radio(host.bb);
  const context = { projectId: "proj_posting", threadId: "thr_posting" };
  const whoami = resultSchema.parse(
    await host.harness.behavior.callRpc("call", {
      context,
      request: { op: "whoami", input: {} },
    }),
  );
  if (!whoami.ok) throw new Error(whoami.error.message);
  const who = identitySchema.parse(whoami.data);
  let loseResponse = false;
  const returned: unknown[] = [];
  const keys: string[] = [];
  const app = await loadPluginApp(async () => ({
    default: definePluginApp((app) => {
      app.slots.navPanel({
        id: "posting-backend-test",
        title: "Posting backend test",
        path: "posting-backend-test",
        icon: "Radio",
        component: () => (
          <ActingContext.Provider
            value={{
              projectId: context.projectId,
              mode: "thread",
              threadId: context.threadId,
              identity: who,
              pending: false,
              perform: async (request) => {
                if (request.op === "tx" || request.op === "reply")
                  keys.push(request.input.idempotencyKey);
                const result = resultSchema.parse(
                  await host.harness.behavior.callRpc("call", {
                    context,
                    request,
                  }),
                );
                if (result.ok) returned.push(result.data);
                if (loseResponse) {
                  loseResponse = false;
                  throw new Error("Response lost after durable acceptance");
                }
                return result;
              },
            }}
          >
            <PostingComposer
              projectId={context.projectId}
              channelId={who.project.channelId}
            />
          </ActingContext.Provider>
        ),
      });
    }),
  }));
  const mount = () =>
    renderSlot(app.navPanels[0]!, { subPath: "" }, { pluginId: "radio" });
  let slot: Awaited<ReturnType<typeof mount>> | undefined;
  try {
    slot = await mount();
    fireEvent.change(slot.getByLabelText("Transmission"), {
      target: { value: "Fresh send" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(returned[0]).toMatchObject({
      state: "sent",
      replayed: false,
      transmission: {
        body: "Fresh send",
        authorId: who.actorId,
        sessionId: context.threadId,
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "New transmission" }));
    fireEvent.change(slot.getByLabelText("Transmission"), {
      target: { value: "Durably accepted before response loss" },
    });
    loseResponse = true;
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    slot.lifecycle.unmount();
    slot = await mount();
    expect(returned).toHaveLength(2);
    fireEvent.click(
      slot.getByRole("button", { name: "Retry original request" }),
    );
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(returned[2]).toMatchObject({ state: "sent", replayed: true });
    expect((returned[2] as { transmission: unknown }).transmission).toEqual(
      (returned[1] as { transmission: unknown }).transmission,
    );
    fireEvent.click(slot.getByRole("button", { name: "New transmission" }));
    fireEvent.change(slot.getByLabelText("Transmission"), {
      target: { value: "Please review @unknown-handle" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(await slot.findByRole("alert")).toBeTruthy();
    const refusedKey = keys.at(-1);
    fireEvent.click(slot.getByLabelText(/I checked channel history/));
    fireEvent.click(slot.getByRole("button", { name: "Edit as new request" }));
    expect(
      (slot.getByLabelText("Transmission") as HTMLTextAreaElement).value,
    ).toBe("Please review @unknown-handle");
    fireEvent.change(slot.getByLabelText("Transmission"), {
      target: { value: "Please review the corrected details" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Send transmission" }));
    expect(
      await slot.findByRole("link", { name: "Open sent transmission" }),
    ).toBeTruthy();
    expect(keys.at(-1)).not.toBe(refusedKey);
    const db = host.bb.storage.database();
    expect(
      db
        .prepare<[], { count: number }>(
          "SELECT count(*) AS count FROM transmissions",
        )
        .get()!.count,
    ).toBe(3);
    expect(
      db
        .prepare<[], { count: number }>(
          "SELECT count(*) AS count FROM response_events",
        )
        .get()!.count,
    ).toBe(0);
    expect(
      db
        .prepare<[], { count: number }>(
          "SELECT count(*) AS count FROM commitments",
        )
        .get()!.count,
    ).toBe(0);
    expect(host.harness.inspection.logEntries).toEqual([]);
  } finally {
    slot?.lifecycle.unmount();
    await host.harness.lifecycle.dispose();
    sessionStorage.clear();
  }
});
