import { z } from "zod";
import { askSchema } from "./api-contract.ts";
import { runSchema } from "./run-contract.ts";
import { idSchema, questionSchema } from "./contracts.ts";
import { assertJson, assertLossless, LIMITS } from "./json.ts";
export const agentInputSchema = z
  .strictObject({
    ask: askSchema
      .omit({ notPrivate: true, threadId: true, projectId: true })
      .optional(),
    run: runSchema.omit({ threadId: true, projectId: true }).optional(),
  })
  .refine(
    (input) => (input.ask === undefined) !== (input.run === undefined),
    "exactly_one_ask_or_run",
  );
/** JSON/byte checks cannot be serialized by the host's Zod converter. Advertise
 * structural constraints, then execute the same strict shared validators. */
const advertised = z.toJSONSchema(agentInputSchema, {
  io: "input",
  unrepresentable: "any",
});
const ask = advertised.properties!.ask as {
  properties: Record<string, unknown>;
};
ask.properties.state = {
  description:
    "Explicit JSON state, at most64KiB per input and256KiB total request. Treated as sensitive.",
};
ask.properties.questions = {
  type: "object",
  minProperties: 1,
  maxProperties: LIMITS.questions,
  propertyNames: z.toJSONSchema(idSchema),
  additionalProperties: z.toJSONSchema(questionSchema, {
    io: "input",
    unrepresentable: "any",
  }),
  description:
    "Named noul, choice or score questions. Runtime validation also checks JSON depth, size and authored criteria.",
};
export const agentParameters = {
  ...advertised,
  oneOf: [{ required: ["ask"] }, { required: ["run"] }],
};

export function parseAgentInput(value: unknown) {
  assertJson(value, LIMITS.requestBytes, LIMITS.depth + 2);
  const input = agentInputSchema.parse(value);
  assertLossless(value, input, LIMITS.requestBytes, LIMITS.depth + 2);
  return input;
}
