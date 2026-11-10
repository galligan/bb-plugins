import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { openRadioStorage } from "./lib/storage.ts";

export default function radio(bb: BbPluginApi): void {
  openRadioStorage(bb.storage);
}
