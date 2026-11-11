import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcContract } from "./lib/contracts.ts";
import { developmentStatus } from "./lib/status.ts";
import { managementContract } from "./lib/setup/contracts.ts";
import { openSetup } from "./lib/setup/storage.ts";
import { createSetupService } from "./lib/setup/service.ts";
import { registerAdmission } from "./lib/setup/admission.ts";
import { botCli } from "./lib/setup/cli.ts";

export default function plugin(bb: BbPluginApi) {
  const store = openSetup(bb.storage);
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  const service = createSetupService(bb, store, lifecycle.signal);
  registerAdmission(bb, store, service.inspect);
  bb.rpc.register(
    defineRpcContract({ ...rpcContract, ...managementContract }),
    {
      status: () => developmentStatus(),
      create: (input, ctx) => service.create(input, ctx.experimental_signal),
      resume: ({ botId }, ctx) =>
        service.resume(botId, ctx.experimental_signal),
      show: ({ botId }) => store.view(botId),
      list: () => store.list(),
      rename: (input, ctx) => service.rename(input, ctx.experimental_signal),
    },
  );
  bb.cli.register(botCli(store, service));
}
