import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createModelService } from "./lib/models.ts";
import { openJudgeStorage } from "./lib/storage.ts";
import { JudgeApi, registerRpc } from "./lib/api.ts";
import { registerTriggerEvents } from "./lib/trigger-registration.ts";
import { registerAgentAccess } from "./lib/agent-access.ts";
import { registerUiUpdates } from "./lib/ui.ts";
import { registerCli } from "./lib/cli.ts";
export { rpcContract } from "./lib/api-contract.ts";

export default async function judge(bb: BbPluginApi): Promise<void> {
  const repository = openJudgeStorage(bb.storage);
  const api = new JudgeApi(
    await createModelService(bb, repository),
    repository,
    bb.sdk,
  );
  bb.onDispose(() => api.dispose());
  registerRpc(bb, api);
  registerCli(bb, api);
  registerTriggerEvents(bb, api);
  registerUiUpdates(bb, api);
  await registerAgentAccess(bb, api);
  bb.log.info(
    "Judge asks and explicit event bindings ready; new bindings start disabled.",
  );
}
