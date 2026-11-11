import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { homeContract } from "./lib/setup/contracts.ts";
import {
  inspectHome,
  prepareHome,
  validateHomeBase,
} from "./lib/setup/home.ts";

export default experimental_defineHostEntry({
  contract: homeContract,
  handlers: {
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
