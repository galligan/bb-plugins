import { createHash, timingSafeEqual } from "node:crypto";
import { RadioError } from "./errors.ts";

/** Read the current server secret for each privileged call; rotation takes effect immediately. */
export async function requireOperator(
  readSecret: () => Promise<string | undefined>,
  provided: string | undefined,
): Promise<void> {
  const expected = await readSecret();
  if (!expected || !provided || provided.length > 1024) {
    throw new RadioError(
      "forbidden",
      "A valid Radio operator credential is required.",
    );
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(provided))) {
    throw new RadioError(
      "forbidden",
      "A valid Radio operator credential is required.",
    );
  }
}
