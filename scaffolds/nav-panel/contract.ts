import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  list: {
    input: z.object({}).strict(),
    output: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        detail: z.string(),
        reviewed: z.boolean(),
      }),
    ),
    tags: () => ["items"],
  },
  review: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ accepted: z.boolean() }),
  },
});
