import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { localContextSchema } from "./local-context.ts";
import { operationSchema } from "./operation-contracts.ts";
import { operationIsRead } from "./operations.ts";

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
export const rpcContract = defineRpcContract({
  call: {
    input: z
      .object({ context: localContextSchema, request: operationSchema })
      .strict(),
    output: resultSchema,
    tags: ({ request }) => (operationIsRead(request.op) ? ["radio"] : []),
  },
});
