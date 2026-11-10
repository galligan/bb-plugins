import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { setRecordSchema } from "./sets-contract.ts";

export const templateContracts = {
  "templates.list": {
    input: z.strictObject({}),
    output: z
      .array(
        z.strictObject({
          id: idSchema,
          version: z.string().max(64),
          description: z.string().max(4096),
          caseCount: z.number().int().min(1).max(100),
        }),
      )
      .max(100),
  },
  "templates.use": {
    input: z.strictObject({ template: idSchema, id: idSchema }),
    output: setRecordSchema,
  },
};
