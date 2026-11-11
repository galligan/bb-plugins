import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcContract } from "./lib/contracts.ts";
import { developmentStatus } from "./lib/status.ts";
import { managementContract } from "./lib/setup/contracts.ts";
import { openSetup } from "./lib/setup/storage.ts";
import { createSetupService } from "./lib/setup/service.ts";
import { registerAdmission } from "./lib/setup/admission.ts";
import { botCli } from "./lib/setup/cli.ts";
import { openSoul } from "./lib/soul/store.ts";
import { soulContract } from "./lib/soul/contracts.ts";

export default function plugin(bb: BbPluginApi) {
  const store = openSetup(bb.storage);
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  const soul = openSoul(bb.storage, store);
  const service = createSetupService(
    bb,
    store,
    lifecycle.signal,
    soul.defaults,
  );
  registerAdmission(bb, store, service.inspect, soul);
  bb.rpc.register(
    defineRpcContract({
      ...rpcContract,
      ...managementContract,
      ...soulContract,
    }),
    {
      status: () => developmentStatus(),
      create: (input, ctx) => service.create(input, ctx.experimental_signal),
      resume: ({ botId }, ctx) =>
        service.resume(botId, ctx.experimental_signal),
      show: ({ botId }) => store.view(botId),
      list: () => store.list(),
      rename: (input, ctx) => service.rename(input, ctx.experimental_signal),
      soulShow: ({ botId }) => soul.show(botId),
      soulUpdate: (input) => soul.update(input),
      defaultsShow: ({ botId }) => soul.defaults(botId),
      defaultsUpdate: (input) => soul.updateDefaults(input),
    },
  );
  bb.cli.register(botCli(store, service, soul));
}
