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
import { createTaskSource } from "./lib/tasks/source.ts";
import { openCommitments } from "./lib/commitments/store.ts";
import { createCommitments } from "./lib/commitments/service.ts";
import { createBrief } from "./lib/brief.ts";
import { openMemory } from "./lib/memory/store.ts";
import { memoryCommands } from "./lib/memory/cli.ts";
import { openCheckpoints } from "./lib/checkpoints/store.ts";
import { checkpointCommands } from "./lib/checkpoints/cli.ts";
import { createRestore } from "./lib/checkpoints/restore.ts";
import { openContinuity } from "./lib/continuity/store.ts";
import { continuityCommands } from "./lib/continuity/cli.ts";
import { taskSettingsContract } from "./lib/tasks/settings-contracts.ts";
import { createTaskSettings } from "./lib/tasks/settings.ts";
import {
  createWorkerOverview,
  workerOverviewContract,
} from "./lib/work/overview.ts";

export default function plugin(bb: BbPluginApi) {
  const store = openSetup(bb.storage);
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  const changed = () => {
    if (!lifecycle.signal.aborted) bb.rpc.experimental_invalidate(["bots"]);
  };
  const soul = openSoul(bb.storage, store, changed);
  const memory = openMemory(bb.storage, store, changed);
  const checkpoints = openCheckpoints(bb.storage, store, soul);
  const work = openWork(bb.storage, store);
  const workerOverview = createWorkerOverview(bb.storage, store, work);
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
  const tasks = createTaskSource(bb, store, lifecycle.signal, changed);
  const taskSettings = createTaskSettings(bb, tasks, lifecycle.signal);
  const commitmentRecords = openCommitments(bb.storage, store, changed);
  const commitments = createCommitments(
    bb,
    commitmentRecords,
    tasks,
    lifecycle.signal,
  );
  const continuity = openContinuity(bb, {
    store,
    memory,
    work,
    tasks,
    commitments: commitmentRecords,
    commitmentStatus: commitments,
    checkpoints,
    lifecycle: lifecycle.signal,
  });
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
      ...taskSettingsContract,
      ...workerOverviewContract,
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
      taskSettings: (input, ctx) =>
        taskSettings.read(input, ctx.experimental_signal),
      taskBoardSelect: (input, ctx) =>
        taskSettings.select(input, ctx.experimental_signal),
      workerOverview: (input, ctx) => {
        lifecycle.signal.throwIfAborted();
        ctx.experimental_signal.throwIfAborted();
        return workerOverview(input);
      },
      taskSource: async ({ botId }, ctx) => {
        const state = await tasks.show(botId, ctx.experimental_signal);
        const source = state.source;
        return uiContract.taskSource.output.parse({
          kind: source?.kind ?? "unconfigured",
          availability: state.availability,
          boardId:
            source?.kind === "tasks" && source.phase === "ready"
              ? source.boardId
              : null,
          file:
            source?.kind === "markdown" && source.phase === "ready"
              ? { hostId: source.hostId, path: source.path }
              : null,
        });
      },
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
    botCli(store, service, soul, {
      workers: workCommands(store, work, workers, routing, changed),
      tasks,
      commitments,
      brief: createBrief(store, soul, work, tasks, commitments, memory),
      memory: memoryCommands(memory, store, lifecycle.signal),
      continuity: continuityCommands(continuity, store, lifecycle.signal),
      checkpoints: checkpointCommands(
        checkpoints,
        store,
        lifecycle.signal,
        createRestore(
          bb,
          store,
          checkpoints,
          memory,
          lifecycle.signal,
          changed,
        ),
      ),
    }),
  );
}
