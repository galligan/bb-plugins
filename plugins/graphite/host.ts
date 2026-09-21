import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";

import { graphiteHostContract } from "./lib/host-contract.ts";
import { readHostStack } from "./lib/host-stack.ts";
import { runGt } from "./lib/gt.ts";

export default experimental_defineHostEntry({
  contract: graphiteHostContract,
  handlers: {
    stack: ({ repoPath, branchName }) => readHostStack(repoPath, branchName),
    async gt({ cwd, args }, context) {
      const result = await runGt(args, { cwd, signal: context.signal });
      return result.outcome === "not_found"
        ? { ...result, tried: [...result.tried] }
        : result;
    },
  },
});
