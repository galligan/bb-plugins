import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../storage/schema.ts";

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const home = z.strictObject({
  botId: idSchema,
  path: z.string().min(1).max(4096),
});
export const taskFileSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  hash: hashSchema,
  markdown: z.string().max(65536),
});
export const taskFilesContract = defineRpcContract({
  tasksInitialize: {
    input: home.extend({ requestId: z.uuid() }),
    output: taskFileSchema,
  },
  tasksRead: { input: home, output: taskFileSchema },
  tasksWrite: {
    input: home.extend({
      expectedHash: hashSchema,
      markdown: z.string().max(65536),
    }),
    output: taskFileSchema,
  },
});
