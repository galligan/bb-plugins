import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./lib/contracts.ts";
import { developmentStatus, formatStatus } from "./lib/status.ts";

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, { status: () => developmentStatus() });
  bb.cli.register(
    defineCli({
      name: "bot",
      summary: "Inspect Bots development status",
      commands: {
        status: cliCommand({
          summary: "Show implemented features and current limitations",
          options: {
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run({ options }) {
            const status = developmentStatus();
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(status) + "\n"
                : formatStatus(status),
            };
          },
        }),
      },
    }),
  );
}
