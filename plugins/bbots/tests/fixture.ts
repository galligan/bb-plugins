import { viewSchema } from "../lib/setup/contracts.ts";

const requestId = "00000000-0000-4000-8000-000000000001";
export const view = viewSchema.parse({
  bot: {
    id: "bot_test",
    name: "Bob",
    revision: 1,
    createdAt: "now",
    updatedAt: "now",
  },
  main: {
    id: "conv_test",
    botId: "bot_test",
    role: "main",
    threadId: "thr_owned",
    createdAt: "now",
  },
  setup: {
    botId: "bot_test",
    conversationId: "conv_test",
    requestId,
    request: { requestId, hostId: "host_test" },
    homePath: "/safe/bot_test",
    projectId: "proj_home",
    phase: "ready",
    error: null,
  },
});
export const soul = {
  current: null,
  lastSuppliedRevision: null,
  lastSuppliedAt: null,
  appliedRevision: null,
  pending: "not-supplied",
  limitation: "Unknown application",
};
