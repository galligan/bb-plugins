import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { publicError, type JudgeApi } from "./api.ts";
import { parseAgentInput, agentParameters } from "./agent-contract.ts";
import { agentOutput } from "./agent-output.ts";
export async function registerAgentAccess(
  bb: BbPluginApi,
  api: JudgeApi,
): Promise<void> {
  const settings = bb.settings.define({
    enableAgentTool: {
      type: "boolean",
      default: false,
      label:
        "Enable judge_ask agent tool and authoring skill (requests may incur charges)",
    },
  });
  let enabled = (await settings.get()).enableAgentTool === true;
  let disposed = false;
  let generation = new AbortController();
  const update = (next: boolean) => {
    if (enabled !== next) {
      generation.abort();
      generation = new AbortController();
      enabled = next;
    }
  };
  settings.onChange((next) => update(next.enableAgentTool === true));
  bb.onDispose(() => {
    disposed = true;
    enabled = false;
    generation.abort();
  });
  bb.agents.configure(() => ({
    tools: enabled ? ["judge_ask"] : [],
    skills: enabled ? ["judge"] : [],
  }));
  bb.agents.registerTool({
    name: "judge_ask",
    description:
      "Run a saved Judge set or judge explicit JSON state. Can incur provider charges. Caller inputs stay sensitive and configured model policy applies.",
    instructions:
      "Supply exactly one of ask or run. Model judgments do not authorize actions. Use configured saved-model IDs.",
    parameters: agentParameters,
    presentation: {
      label: { pending: "Running Judge", completed: "Ran Judge" },
      icon: { glyph: "Scale" },
    },
    async execute(value, ctx) {
      const error = (code: string) => ({
        isError: true,
        content: [
          { type: "text" as const, text: JSON.stringify({ error: { code } }) },
        ],
      });
      if (disposed || ctx.signal.aborted) return error("cancelled");
      try {
        const beforeRead = generation;
        const current = await settings.get();
        if (disposed || ctx.signal.aborted) return error("cancelled");
        // A notification is newer than this read. Never restore its old value
        // or let disable/re-enable revive a request admitted before revocation.
        if (beforeRead !== generation)
          return error(enabled ? "cancelled" : "agent_tool_disabled");
        update(current.enableAgentTool === true);
        if (!enabled) return error("agent_tool_disabled");
        const input = parseAgentInput(value);
        const signal = AbortSignal.any([ctx.signal, generation.signal]);
        const context = { threadId: ctx.threadId, projectId: ctx.projectId };
        const run = input.ask
          ? await api.asks.ask(
              { ...input.ask, ...context, notPrivate: false },
              signal,
            )
          : await api.runner.run({ ...input.run!, ...context }, signal);
        return { content: [{ type: "text" as const, text: agentOutput(run) }] };
      } catch (caught) {
        return error(publicError(caught));
      }
    },
  });
}
