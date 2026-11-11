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
import { uiContract } from "./lib/ui/contracts.ts";
import { openWork } from "./lib/work/storage.ts";
import { createRouting } from "./lib/work/routing.ts";
import { createWorkService } from "./lib/work/service.ts";
import { createWorkerAdmission } from "./lib/work/admission.ts";
import { workCommands } from "./lib/work/cli.ts";

export default function plugin(bb: BbPluginApi) {
  const store = openSetup(bb.storage);
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  const changed = () => {
    if (!lifecycle.signal.aborted) bb.rpc.experimental_invalidate(["bots"]);
  };
  const soul = openSoul(bb.storage, store, changed);
  const work = openWork(bb.storage, store);
  const routing = createRouting(bb, store, work);
  const workers = createWorkService(
    bb,
    store,
    work,
    soul,
    routing,
    lifecycle.signal,
    changed,
  );
  const service = createSetupService(
    bb,
    store,
    lifecycle.signal,
    soul.defaults,
    changed,
    workers.finishTitles,
  );
  registerAdmission(
    bb,
    store,
    service.inspect,
    soul,
    createWorkerAdmission(store, work, workers),
  );
  bb.rpc.register(
    defineRpcContract({
      ...rpcContract,
      ...managementContract,
      ...soulContract,
      ...uiContract,
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
      ownership: ({ keys }) =>
        Object.fromEntries(
          keys.map((threadId) => {
            const owner = store.conversations.ownerOfThread(threadId);
            if (!owner) return [threadId, null];
            const bot = store.profiles.get(owner.botId);
            return [
              threadId,
              { botId: bot.id, name: bot.name, role: owner.role },
            ];
          }),
        ),
      creation: ({ requestId }) => {
        const setup = store.findRequest(requestId);
        return setup ? store.view(setup.botId) : null;
      },
    },
  );
  bb.cli.register(
    botCli(
      store,
      service,
      soul,
      workCommands(store, work, workers, routing, changed),
      work,
    ),
  );
}
