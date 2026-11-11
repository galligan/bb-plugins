import type { PluginCliContext } from "@get-bb/plugin-sdk";
import { RadioError } from "./errors.ts";

export const contextOptions = {
  thread: {
    type: "string",
    description:
      "Act for this verified BB thread; required when invocation context is absent.",
  },
  project: {
    type: "string",
    description:
      "BB project ID; must match the acting thread, or is required for --as-user.",
  },
  "as-user": {
    type: "boolean",
    description:
      "Explicit human mode; requires --project and --operator-credential-stdin. Never put the secret in argv.",
  },
  "operator-credential": {
    type: "string",
    stdin: true,
    hidden: true,
    description:
      "Human operator credential (16–1024 characters); prefer --operator-credential-stdin. Never needed for ordinary thread calls.",
  },
  json: {
    type: "boolean",
    description: "Emit the structured result/error envelope.",
  },
} as const;

export function cliContext(
  options: {
    thread?: string;
    project?: string;
    "as-user": boolean;
    "operator-credential"?: string;
  },
  invocation: PluginCliContext,
) {
  if (options["as-user"]) {
    if (!options.project || options.thread)
      throw new RadioError(
        "invalid_input",
        "Use --as-user with --project and no --thread.",
      );
    return {
      asUser: true,
      projectId: options.project,
      operatorCredential: options["operator-credential"],
    };
  }
  return {
    threadId: options.thread ?? invocation.threadId,
    projectId:
      options.project ?? (options.thread ? undefined : invocation.projectId),
    operatorCredential: options["operator-credential"],
  };
}

export function parseCliInput(source: string | undefined): unknown {
  if (source === undefined) return {};
  if (Buffer.byteLength(source, "utf8") > 262144)
    throw new RadioError(
      "invalid_input",
      "Operation input exceeds 262144 UTF-8 bytes.",
    );
  try {
    return JSON.parse(source);
  } catch {
    throw new RadioError(
      "invalid_input",
      "Operation input must be valid JSON.",
    );
  }
}
