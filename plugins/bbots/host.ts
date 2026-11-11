import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { homeContract } from "./lib/setup/contracts.ts";
import { taskFilesContract } from "./lib/tasks/contracts.ts";
import { initializeTasks, readTasks, writeTasks } from "./lib/tasks/files.ts";
import {
  inspectHome,
  prepareHome,
  validateHomeBase,
} from "./lib/setup/home.ts";

export default experimental_defineHostEntry({
  contract: { ...homeContract, ...taskFilesContract },
  handlers: {
    tasksInitialize: ({ botId, path, requestId }, context) =>
      initializeTasks(botId, path, requestId, context.signal),
    tasksRead: ({ botId, path }, context) =>
      readTasks(botId, path, context.signal),
    tasksWrite: ({ botId, path, expectedHash, markdown }, context) =>
      writeTasks(botId, path, expectedHash, markdown, context.signal),
    validateBase: ({ base }, context) =>
      validateHomeBase(
        base,
        context.experimental_paths.dataDir,
        context.signal,
      ),
    prepare: ({ botId, base }, context) =>
      prepareHome(
        botId,
        base,
        context.signal,
        context.experimental_paths.dataDir,
      ),
    inspect: async ({ botId, path }) => ({
      status: await inspectHome(botId, path),
    }),
  },
});
