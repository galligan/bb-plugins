export class StoreError extends Error {
  readonly code:
    "not_found" | "revision_conflict" | "already_bound" | "thread_owned";
  constructor(
    code: "not_found" | "revision_conflict" | "already_bound" | "thread_owned",
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}
