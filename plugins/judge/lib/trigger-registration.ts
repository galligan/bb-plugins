import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { publicError, type JudgeApi } from "./api.ts";
/** Lifecycle observers clear stale display state; only idle/failed bindings invoke inference. */
export function registerTriggerEvents(bb: BbPluginApi, api: JudgeApi): void {
  const safe = async (operation: () => void | Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      bb.log.warn(`Judge trigger operation failed (${publicError(error)})`);
    }
  };
  bb.events.on("thread.idle", (payload) =>
    safe(() => api.triggerEngine.idle(payload)),
  );
  bb.events.on("turn.failed", (payload) =>
    safe(() => api.triggerEngine.failed(payload)),
  );
  bb.events.on("thread.active", ({ thread }) =>
    safe(() => api.triggerEngine.advance(thread.id)),
  );
  bb.events.on("thread.failed", ({ thread }) =>
    safe(() => api.triggerEngine.advance(thread.id)),
  );
  bb.events.on("thread.archived", ({ thread }) =>
    safe(() => api.triggerEngine.advance(thread.id)),
  );
  bb.events.on("thread.deleted", ({ thread }) =>
    safe(() => api.triggerEngine.advance(thread.id)),
  );
  bb.events.on("experimental_thread.events", ({ thread, sequence }) =>
    safe(() => api.triggerEngine.observe(thread.id, sequence)),
  );
  api.publisher.reconcile();
}
