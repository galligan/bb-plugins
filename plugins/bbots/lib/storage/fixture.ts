import { StoreError } from "./errors.ts";

export const change = {
  author: "fixture-author",
  reason: "Explicit fixture change",
};
export const isCode = (code: StoreError["code"]) => (error: unknown) =>
  error instanceof StoreError && error.code === code;
