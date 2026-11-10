import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createModelService } from "./lib/models.ts";
import { openJudgeStorage } from "./lib/storage.ts";

export default async function judge(bb: BbPluginApi): Promise<void> {
  await createModelService(bb, openJudgeStorage(bb.storage));
  bb.log.info(
    "Judge settings loaded; explicit inference is not implemented yet.",
  );
}
