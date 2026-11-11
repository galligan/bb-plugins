import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { homeContract } from "./lib/setup/contracts.ts";
import { inspectHome, prepareHome } from "./lib/setup/home.ts";

export default experimental_defineHostEntry({
  contract: homeContract,
  handlers: {
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
