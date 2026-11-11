import { useRadioVisible } from "./use-radio-visible.ts";
import { useMemo, useRef } from "react";
import { z } from "zod";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../lib/surface-contract.ts";
import type { OperationInput } from "./acting-context.ts";

/** Thread-only watched reads. Operator credentials cannot enter this query input. */
export function useLocalRead<T>(
  projectId: string,
  threadId: string,
  request: Extract<OperationInput, { op: "whoami" | "check" | "listening" }>,
  schema: z.ZodType<T>,
) {
  const visible = useRadioVisible();
  const query = experimental_useRpcQuery({
    contract: rpcContract,
    method: "call",
    input: { context: { projectId, threadId }, request },
    enabled: visible,
  });
  const parsed = useMemo(
    () => (query.data?.ok ? schema.safeParse(query.data.data) : null),
    [query.data, schema],
  );
  const key = JSON.stringify({ projectId, threadId, request });
  const last = useRef<{ key: string; data: T } | null>(null);
  if (parsed?.success) last.current = { key, data: parsed.data };
  return {
    data: last.current?.key === key ? last.current.data : undefined,
    error:
      query.error?.message ??
      (query.data && !query.data.ok
        ? query.data.error.message
        : parsed && !parsed.success
          ? "Radio returned an unsupported view."
          : null),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
