import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { BotRecordsPanel } from "../components/records/panel.tsx";
import { recordsContract } from "../lib/ui/records-contracts.ts";

export const recordOwner = {
  botId: "bot_test",
  name: "Bob",
  role: "main" as const,
};
export const noteId = "mem_00000000-0000-4000-8000-000000000001";
export const checkpointId = "chk_00000000-0000-4000-8000-000000000001";
export const recordIndex = recordsContract.botRecords.output.parse({
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Bob",
  memory: {
    items: [
      {
        id: noteId,
        revision: 2,
        kind: "knowledge",
        topic: "Keep evidence",
        basis: "inference",
        excerpt: "A bounded excerpt.",
        sources: ["thread:source#msg=1"],
        sourceCount: 1,
      },
    ],
    nextCursor: null,
  },
  checkpoints: {
    items: [
      {
        id: checkpointId,
        botId: "bot_test",
        name: "Before edits",
        author: "user",
        reason: "Explicit save",
        createdAt: "2026-11-11T20:00:00.000Z",
      },
    ],
    nextCursor: null,
  },
});
export const fullNote = recordsContract.botMemory.output.parse({
  threadId: "thr_owned",
  botId: "bot_test",
  name: "Bob",
  availability: "available",
  note: {
    id: noteId,
    revision: 2,
    kind: "knowledge",
    topic: "Keep evidence",
    basis: "inference",
    sources: ["thread:source#msg=1"],
    sourceCount: 1,
    markdown: "# Full evidence\n\nA retained note body beyond the excerpt.",
  },
});
export async function recordsFixture(options: RenderSlotOptions = {}) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  if (app.tabs[0]?.component !== BotRecordsPanel)
    throw new Error(
      "The app did not register the expected Bot records component",
    );
  const slot = renderSlot(
    { component: BotRecordsPanel },
    { threadId: "thr_owned", environment: null },
    {
      ...options,
      rpc: {
        ownership: (input) =>
          Object.fromEntries(
            (input as { keys: string[] }).keys.map((key) => [
              key,
              key === "thr_owned" ? recordOwner : null,
            ]),
          ),
        botRecords: () => recordIndex,
        botMemory: () => fullNote,
        ...options.rpc,
      },
    },
  );
  return { app, slot };
}
