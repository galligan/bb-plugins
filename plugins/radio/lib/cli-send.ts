import { cliCommand } from "@get-bb/plugin-sdk";
import type { LocalRadioService } from "./local-service.ts";
import { surfaceFailure } from "./local-service.ts";
import { cliContext, contextOptions, parseCliInput } from "./cli-context.ts";
import { RadioError } from "./errors.ts";

export function sendCommand(service: LocalRadioService, op: "tx" | "reply") {
  return cliCommand({
    summary:
      op === "tx"
        ? "Store a short transmission; sent means durable acceptance, not receipt."
        : "Reply in the parent channel for one canonical recipient; no inherited audience.",
    positionals: [
      {
        name: "body",
        description:
          "Essential transmission text, 1–400 Unicode code points; use a dispatch/ref for detail.",
      },
    ],
    options: {
      ...contextOptions,
      ch: {
        type: "string",
        description:
          "Posting path project or project/subchannel; choose this or --channel-id.",
      },
      "channel-id": {
        type: "string",
        description: "Canonical posting channel ID; choose this or --ch.",
      },
      key: {
        type: "string",
        description:
          "Required stable idempotency key, 1–128 characters. Retry the exact input/key.",
      },
      to: {
        type: "string",
        repeatable: true,
        split: ",",
        description:
          "Explicit canonical recipients (100 distinct/1000 raw maximum); comma-separated or repeatable.",
      },
      refs: {
        type: "string",
        description:
          "JSON array of up to 16 structured refs; HTTP(S) URLs are stored without fetching.",
      },
      parent: {
        type: "string",
        description: "Canonical parent tx ID, required for reply.",
      },
      "reply-for": {
        type: "string",
        description:
          "Exact original recipient being answered; required when both actor/session are eligible.",
      },
      exclusive: {
        type: "boolean",
        description:
          "Open one exclusive claim slot; abandoning it requires author-controlled reopen.",
      },
      "require-ack": {
        type: "boolean",
        description:
          "Require an independent explicit ack for each frozen recipient.",
      },
      "expect-reply": {
        type: "boolean",
        description: "Require one substantive reply per frozen recipient.",
      },
    },
    constraints: [{ kind: "exactly-one", options: ["ch", "channel-id"] }],
    async run({ options, positionals }, invocation) {
      let result;
      try {
        if (!positionals.body || !options.key)
          throw new RadioError(
            "invalid_input",
            "Supply a body and --key; choose --ch or --channel-id.",
          );
        result = await service.local(
          cliContext(options, invocation),
          {
            op,
            input: {
              ...(options.ch
                ? { ch: options.ch }
                : { channelId: options["channel-id"] }),
              body: positionals.body,
              idempotencyKey: options.key,
              recipientIds: options.to,
              ...(options.refs ? { refs: parseCliInput(options.refs) } : {}),
              ...(options.parent ? { replyToId: options.parent } : {}),
              ...(options["reply-for"]
                ? { replyForId: options["reply-for"] }
                : {}),
              requestMode: options.exclusive ? "exclusive" : "discussion",
              requireAck: options["require-ack"],
              expectReply: options["expect-reply"],
            },
          },
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
