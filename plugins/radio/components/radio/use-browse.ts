import { useRadioVisible } from "./use-radio-visible.ts";
import { useRef } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import {
  browseContract,
  browseOperationSchema,
} from "../../lib/browse-contract.ts";

export function useBrowse<T>(
  projectId: string,
  request: z.input<typeof browseOperationSchema>,
  schema: z.ZodType<T>,
  enabled = true,
) {
  const visible = useRadioVisible();
  const query = experimental_useRpcQuery({
    contract: browseContract,
    method: "browse",
    input: { projectId, request },
    enabled: visible && enabled,
  });
  const key = JSON.stringify({ projectId, request });
  const last = useRef<{
    key: string;
    data: T;
    project: { id: string; name: string; channelId: string };
  } | null>(null);
  const parsed = query.data?.ok ? schema.safeParse(query.data.data) : undefined;
  if (parsed?.success && query.data?.ok)
    last.current = { key, data: parsed.data, project: query.data.project };
  // Domain refusals arrive in-band; retain only this exact read's previous content.
  // Transport cache, cancellation, reconnect and invalidation remain host-owned.
  const data = last.current?.key === key ? last.current.data : undefined;
  const error =
    query.error?.message ??
    (query.data && !query.data.ok
      ? query.data.error.message
      : parsed && !parsed.success
        ? "Radio returned an unsupported view. Refresh to retry."
        : null);
  return {
    data,
    error,
    project:
      last.current?.project.id === projectId ? last.current.project : undefined,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
