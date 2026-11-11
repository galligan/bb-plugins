import { z } from "zod";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { RadioOperations, operationIsRead } from "./operations.ts";
import { operationSchema } from "./operation-contracts.ts";
import { RadioError } from "./errors.ts";
import type { SurfaceResult } from "./surface-contract.ts";

/** Adapters resolve authority first; request fields never construct this context. */
export function executeSurface(
  operations: RadioOperations,
  context: TransmissionContext,
  input: unknown,
  invalidate: () => void,
  signal?: AbortSignal,
): SurfaceResult {
  try {
    const request = operationSchema.safeParse(input);
    if (!request.success)
      throw new RadioError(
        "invalid_input",
        "Invalid Radio operation; use the declared input schema.",
      );
    const data = operations.execute(context, request.data, signal);
    if (!operationIsRead(request.data.op)) invalidate();
    return {
      ok: true,
      data: z.json().parse(data),
      attention: operations.hint(context),
    };
  } catch (error) {
    return surfaceFailure(error);
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
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return {
      ok: false,
      error: {
        code: "aborted",
        message: "Radio request cancelled or its deadline elapsed.",
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
