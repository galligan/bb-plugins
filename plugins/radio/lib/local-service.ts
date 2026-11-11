import { z } from "zod";
import type { BbPluginApi, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import type { RadioStore } from "./storage.ts";
import { LocalContexts } from "./local-context.ts";
import { RadioOperations } from "./operations.ts";
import type { SurfaceResult } from "./surface-contract.ts";
import { executeSurface, surfaceFailure } from "./surface-result.ts";
export { surfaceFailure } from "./surface-result.ts";

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
      return executeSurface(
        this.operations,
        await this.contexts.resolve(context, signal),
        request,
        this.invalidate,
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
      return executeSurface(
        this.operations,
        await this.contexts.native(context),
        request,
        this.invalidate,
        context.signal,
      );
    } catch (error) {
      return surfaceFailure(error);
    }
  }
}
