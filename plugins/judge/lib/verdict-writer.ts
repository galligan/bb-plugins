import type { SourceSdk } from "./sources/contracts.ts";
import type { Deadline } from "./deadline.ts";
import { assertJson, canonicalJson } from "./json.ts";
import { parseMetadata } from "./verdict-metadata.ts";

/** Two actual mutations at most; an abort-ignoring write keeps its slot until it settles. */
export class VerdictMetadataWriter {
  private sdk: SourceSdk;
  private writes = new Set<string>();
  private settled: (aborted: boolean) => void;
  constructor(sdk: SourceSdk, settled: (aborted: boolean) => void) {
    this.sdk = sdk;
    this.settled = settled;
  }
  busy(threadId?: string): boolean {
    return (
      this.writes.size >= 2 ||
      (threadId !== undefined && this.writes.has(threadId))
    );
  }
  hasPending(): boolean {
    return this.writes.size > 0;
  }
  async keys(threadId: string, scope: Deadline): Promise<string[]> {
    if (this.busy(threadId)) throw new Error("metadata_busy");
    const prior = await scope.run(() =>
      this.sdk.threads.getPluginMetadata({ threadId, signal: scope.signal }),
    );
    assertJson(prior, 256 * 1024, 16);
    if (prior === null || Array.isArray(prior) || typeof prior !== "object")
      throw new Error("metadata_invalid");
    const keys = Object.keys(prior);
    if (keys.length > 256) throw new Error("metadata_invalid");
    return keys.filter((key) => key !== "verdicts");
  }
  async write(
    threadId: string,
    metadata: ReturnType<typeof parseMetadata>,
    remove: string[],
    scope: Deadline,
  ) {
    scope.assertActive();
    if (this.busy(threadId)) throw new Error("metadata_busy");
    this.writes.add(threadId);
    let pending: ReturnType<SourceSdk["threads"]["updatePluginMetadata"]>;
    try {
      pending = this.sdk.threads.updatePluginMetadata({
        threadId,
        set: metadata,
        remove,
        signal: scope.signal,
      });
    } catch (error) {
      this.writes.delete(threadId);
      throw error;
    }
    const release = () => {
      this.writes.delete(threadId);
      try {
        this.settled(scope.signal.aborted);
      } catch {
        /* A generation may already be disposed. */
      }
    };
    void pending.then(release, release);
    const returned = parseMetadata(await scope.run(() => pending));
    if (canonicalJson(returned) !== canonicalJson(metadata))
      throw new Error("metadata_invalid");
    return returned;
  }
}
