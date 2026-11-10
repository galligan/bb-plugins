import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createModelService } from "./lib/models.ts";
import { openJudgeStorage } from "./lib/storage.ts";
import { JudgeApi, registerRpc } from "./lib/api.ts";
import { registerCli } from "./lib/cli.ts";
export { rpcContract } from "./lib/api-contract.ts";

export default async function judge(bb: BbPluginApi): Promise<void> {
  const repository = openJudgeStorage(bb.storage);
  const api = new JudgeApi(
    await createModelService(bb, repository),
    repository,
  );
  bb.onDispose(() => api.dispose());
  registerRpc(bb, api);
  registerCli(bb, api);
  bb.log.info("Judge explicit asks ready; triggers remain disabled.");
}
