import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type Database = ReturnType<BbPluginApi["storage"]["database"]>;

export class PersistenceError extends Error {
  constructor() {
    super("persistence_failed");
    this.name = "PersistenceError";
  }
}

export function persist<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new PersistenceError();
  }
}
