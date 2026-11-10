import { z } from "zod";
// Browser-safe display DTOs: no server validators, secrets, inputs or answers.
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const displayRowSchema = z.strictObject({
  threadId: id,
  badges: z
    .array(
      z.strictObject({
        setId: id,
        label: z
          .string()
          .min(1)
          .max(64)
          .refine((v) => v.trim().length > 0 && !/\p{Cc}/u.test(v)),
      }),
    )
    .max(20),
  extraBadges: z.number().int().min(0).max(1280),
  publicationFailure: id.nullable(),
});
export const displayRowsSchema = z.strictObject({
  threads: z.array(displayRowSchema).max(200),
});
export const threadDisplaySchema = z.strictObject({
  current: displayRowSchema,
  latest: z
    .strictObject({
      runId: id,
      setId: id.nullable(),
      startedAt: z.number().int().nonnegative(),
      status: z.enum([
        "current",
        "recorded",
        "uncalibrated",
        "incomplete",
        "unavailable",
      ]),
      code: id.nullable(),
      models: z
        .array(
          z.strictObject({
            id,
            model: z.string().min(1).max(256),
            providerModel: z.string().max(256).nullable(),
          }),
        )
        .max(16),
    })
    .nullable(),
});
export type DisplayRow = z.infer<typeof displayRowSchema>;
export type ThreadDisplay = z.infer<typeof threadDisplaySchema>;
export const uiContracts = {
  "ui.badges": {
    input: z.strictObject({
      threadIds: z
        .array(id)
        .min(1)
        .max(200)
        .refine((ids) => new Set(ids).size === ids.length),
    }),
    output: displayRowsSchema,
  },
  "ui.thread": {
    input: z.strictObject({ threadId: id }),
    output: threadDisplaySchema,
  },
  "projects.get": {
    input: z.strictObject({ projectId: id }),
    output: z.strictObject({ projectId: id, enabled: z.boolean() }),
  },
};
