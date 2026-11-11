import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliCommand,
} from "@get-bb/plugin-sdk";
import { operationSchema } from "./operation-contracts.ts";
import { z } from "zod";
import { surfaceFailure, type LocalRadioService } from "./local-service.ts";
import { cliContext, contextOptions, parseCliInput } from "./cli-context.ts";
import { sendCommand } from "./cli-send.ts";

export function registerCli(bb: BbPluginApi, service: LocalRadioService) {
  const commands: Record<string, PluginCliCommand> = {};
  for (const variant of operationSchema.options) {
    const op = variant.shape.op.value;
    if (op === "tx" || op === "reply") {
      commands[op] = sendCommand(service, op);
      continue;
    }
    commands[op] = cliCommand({
      summary: `Radio ${op}; validated JSON input, explicit actor context and bounded output.`,
      description: `Use --input '{}' for empty reads. Reads never confirm receipt.\nJSON input schema:\n${JSON.stringify(z.toJSONSchema(variant.shape.input, { io: "input" }), null, 2)}`,
      options: {
        ...contextOptions,
        input: {
          type: "string",
          stdin: true,
          description:
            "Operation fields as JSON (262144 UTF-8 byte input cap; stdin single-line cap 16KiB). Domain limits also apply.",
        },
      },
      async run({ options }, invocation) {
        let result;
        try {
          result = await service.local(
            cliContext(options, invocation),
            { op, input: parseCliInput(options.input) },
            invocation.signal,
          );
        } catch (error) {
          result = surfaceFailure(error);
        }
        return {
          exitCode: result.ok ? 0 : 1,
          stdout: JSON.stringify(result) + "\n",
        };
      },
    });
  }
  bb.cli.register(
    defineCli({
      name: "radio",
      summary:
        "Short durable transmissions, explicit response facts and commitments.",
      description:
        "Use tx/reply for short text; other operations accept --input JSON. Missing invocation context requires --thread. Human actions require explicit --as-user and a separate operator credential.",
      commands,
    }),
  );
}
