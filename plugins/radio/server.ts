import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerTrustedHttp } from "./lib/trusted-http.ts";
import { registerLocalSurfaces } from "./lib/local-surfaces.ts";
export { rpcContract } from "./lib/surface-contract.ts";
import { openRadioStorage } from "./lib/storage.ts";

export default function radio(bb: BbPluginApi): void {
  const store = openRadioStorage(bb.storage);
  registerLocalSurfaces(bb, store);
  registerTrustedHttp(bb, store);
}
