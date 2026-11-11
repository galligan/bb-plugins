import { z } from "zod";
import type { BbPluginApi, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { LocalContexts } from "./local-context.ts";
import { RadioOperations, operationIsRead } from "./operations.ts";
import { operationSchema } from "./operation-contracts.ts";
import { RadioError } from "./errors.ts";
import type { SurfaceResult } from "./surface-contract.ts";

export class LocalRadioService {
  private contexts: LocalContexts;
  private operations: RadioOperations;
  private invalidate: () => void;
  constructor(bb: BbPluginApi, store: RadioStore) {
    const settings = bb.settings.define({
      operatorCredential: {
        type: "string",
        label: "Radio operator credential",
        secret: true,
        experimental_schema: z.string().min(16).max(1024),
      },
    });
    this.contexts = new LocalContexts(
      bb.sdk,
      bb.storage.database(),
      store,
      async () => (await settings.get()).operatorCredential,
    );
    this.operations = new RadioOperations(bb.storage.database(), store);
    this.invalidate = () => bb.rpc.experimental_invalidate(["radio"]);
  }

  async local(
    context: unknown,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<SurfaceResult> {
    try {
      return this.execute(
        await this.contexts.resolve(context, signal),
        request,
        signal,
      );
    } catch (error) {
      return surfaceFailure(error);
    }
  }

  async native(
    context: PluginAgentToolContext,
    request: unknown,
  ): Promise<SurfaceResult> {
    try {
      return this.execute(
        await this.contexts.native(context),
        request,
        context.signal,
      );
    } catch (error) {
      return surfaceFailure(error);
    }
  }

  private execute(
    context: TransmissionContext,
    input: unknown,
    signal?: AbortSignal,
  ): SurfaceResult {
    const request = operationSchema.safeParse(input);
    if (!request.success)
      throw new RadioError(
        "invalid_input",
        "Invalid Radio operation; use the declared input schema.",
      );
    const data = this.operations.execute(context, request.data, signal);
    if (!operationIsRead(request.data.op)) this.invalidate();
    // Domain results are plain bounded JSON. A read-only hint does not record receipt.
    return {
      ok: true,
      data: z.json().parse(data),
      attention: this.operations.hint(context),
    };
  }
}

export function surfaceFailure(error: unknown): SurfaceResult {
  if (error instanceof RadioError)
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        choices: error.choices,
      },
    };
  if (error instanceof Error && error.name === "AbortError")
    return {
      ok: false,
      error: {
        code: "aborted",
        message: "Radio request cancelled.",
        choices: [],
      },
    };
  return {
    ok: false,
    error: {
      code: "internal_error",
      message:
        "Radio operation failed; no success or delivery evidence is implied. Retry writes only with their original key and input.",
      choices: [],
    },
  };
}
