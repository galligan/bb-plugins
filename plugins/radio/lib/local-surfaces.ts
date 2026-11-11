import { registerBrowse } from "./browse-service.ts";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { RadioStore } from "./storage.ts";
import { operationSchema } from "./operation-contracts.ts";
import { LocalRadioService } from "./local-service.ts";
import { rpcContract } from "./surface-contract.ts";
import { registerCli } from "./cli.ts";
export { rpcContract } from "./surface-contract.ts";

export function registerLocalSurfaces(bb: BbPluginApi, store: RadioStore) {
  const service = new LocalRadioService(bb, store);
  bb.rpc.register(
    rpcContract,
    {
      call: ({ context, request }, invocation) =>
        service.local(context, request, invocation.experimental_signal),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Radio shared operations. Local client/plugin origin never implies human authority; pass verified thread/project context, or explicit operator-authorized human context.",
    },
  );
  registerCli(bb, service);
  registerBrowse(bb, store);
  bb.agents.registerTool({
    name: "radio_call",
    description:
      "Read or store Radio transmissions, dispatches, response facts, commitments and subscriptions. Use check for attention, scan/read for content. Writes persist records; they never start another agent. Sent is not received. Human-only operations require the operator CLI and cannot be authorized through this tool.",
    instructions:
      "Use your invoking actor/session. Keep transmission bodies within 400 Unicode code points. Confirm received only after reading actual content; hints/counts/ack are not receipt. For mixed actor/session audiences, select one exact replyForId or response targetId. Listening never authorizes wake or a polling loop.",
    parameters: z.object({ request: operationSchema }).strict(),
    presentation: {
      label: { pending: "Calling Radio", completed: "Called Radio" },
      icon: { glyph: "Radio" },
    },
    async execute({ request }, context) {
      const result = await service.native(context, request);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    },
  });
  bb.agents.configure(() => ({ tools: ["radio_call"], skills: ["radio"] }));
}
