import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { localContextSchema } from "./local-context-contract.ts";
import {
  operationSchema,
  operationIsRead,
  type RadioOperation,
} from "./operation-contracts.ts";

const sample = z
  .object({ sampleCount: z.number().int().min(0).max(1), hasMore: z.boolean() })
  .strict();
export const hintSchema = z
  .object({ discovery: sample, required: sample, commitments: sample })
  .strict();
export const resultSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), data: z.json(), attention: hintSchema })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
            "invalid_input",
            "not_found",
            "conflict",
            "forbidden",
            "ambiguous",
            "aborted",
            "internal_error",
          ]),
          message: z.string().max(2048),
          choices: z.array(z.string().max(513)).max(100),
        })
        .strict(),
    })
    .strict(),
]);
export type SurfaceResult = z.infer<typeof resultSchema>;
export const rpcContract = {
  call: {
    input: z
      .object({ context: localContextSchema, request: operationSchema })
      .strict(),
    output: resultSchema,
    tags: ({ request }: { request: RadioOperation }) =>
      operationIsRead(request.op) ? ["radio"] : [],
  },
} satisfies PluginRpcContract;
