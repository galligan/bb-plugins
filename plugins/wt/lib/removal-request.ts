type RemovalResult =
  { status: "requested" | "removed" } | { status: "failed"; message: string };
/** Core owns environments even when teardown failed; only an orphan uses the host. */
export async function requestRemoval(
  environment: { id: string; failed: boolean } | null,
  actions: {
    deleteEnvironment: (id: string) => Promise<unknown>;
    cleanupEnvironment: (id: string) => Promise<unknown>;
    removeOrphan: () => Promise<RemovalResult>;
  },
): Promise<RemovalResult> {
  try {
    if (environment === null) return await actions.removeOrphan();
    if (environment.failed) await actions.cleanupEnvironment(environment.id);
    else await actions.deleteEnvironment(environment.id);
    return { status: "requested" };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
