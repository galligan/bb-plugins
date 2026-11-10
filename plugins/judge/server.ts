import type { BbPluginApi } from "@get-bb/plugin-sdk";

// Preparation scaffold: register capabilities as their implementation lands.
export default function judge(bb: BbPluginApi): void {
  bb.log.info("Judge scaffold loaded; inference is not implemented.");
}
