import { useRadioVisible } from "./use-radio-visible.ts";
import { normalizeName } from "../../lib/names.ts";
import { useRef, useState } from "react";
import { z } from "zod";
import { useActing, type OperationInput } from "./acting-context.ts";
import { pageSchema } from "./view-schemas.ts";
export const handleSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  targetId: z.string(),
  isPrimary: z.boolean(),
});
const handlesSchema = pageSchema(handleSchema, z.string());
export const humanProfileSchema = z.object({
  stationId: z.string(),
  actorId: z.string(),
  displayName: z.string().min(1).max(256),
});
const handleResultSchema = z.object({
  handle: handleSchema,
  normalization: z.object({
    requested: z.string(),
    name: z.string(),
    corrected: z.boolean(),
  }),
  displaced: z
    .object({ targetId: z.string(), fallbackName: z.string() })
    .nullable()
    .optional(),
});
type Change = Extract<
  OperationInput,
  {
    op:
      | "handle-assign"
      | "handle-rename"
      | "handle-reclaim"
      | "alias-remove"
      | "human-profile-set";
  }
>;
export function useIdentitySettings() {
  const acting = useActing();
  const visible = useRadioVisible();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState<z.infer<typeof handlesSchema> | null>(null);
  const [cursors, setCursors] = useState([""]);
  const [profile, setProfile] = useState<z.infer<
    typeof humanProfileSchema
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<"handles" | "profile" | null>(
    null,
  );
  const [inspected, setInspected] = useState(false);
  const [uncertainName, setUncertainName] = useState<string | null>(null);
  const [observedHandle, setObservedHandle] = useState<{
    name: string;
    handle: z.infer<typeof handleSchema> | null;
  } | null>(null);
  const blocked = !visible || pending || acting.pending;
  async function read(kind: "handles" | "profile", nextCursors = cursors) {
    if (!visible || busy.current || acting.pending) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setInspected(false);
    try {
      const result = await acting.perform(
        kind === "handles"
          ? { op: "handles", input: { after: nextCursors.at(-1)!, limit: 20 } }
          : { op: "human-profile", input: {} },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (kind === "handles") {
        const parsed = handlesSchema.safeParse(result.data);
        if (
          !parsed.success ||
          parsed.data.items.some((h) => h.projectId !== acting.projectId)
        )
          throw new Error("Unsupported handle page");
        setPage(parsed.data);
        setCursors(nextCursors);
      } else {
        const parsed = humanProfileSchema.parse(result.data);
        if (
          parsed.stationId !== acting.identity!.stationId ||
          parsed.actorId !== acting.identity!.actorId
        )
          throw new Error("Profile scope changed");
        setProfile(parsed);
      }
      if (uncertain === kind && kind === "handles" && uncertainName) {
        const current = await acting.perform({
          op: "handle-read",
          input: { name: uncertainName },
        });
        if (!current.ok) throw new Error("Affected handle lookup failed");
        const observation = z
          .object({ handle: handleSchema.nullable() })
          .parse(current.data);
        if (
          observation.handle &&
          (observation.handle.projectId !== acting.projectId ||
            observation.handle.name !== uncertainName)
        )
          throw new Error("Affected handle scope changed");
        setObservedHandle({ name: uncertainName, handle: observation.handle });
        setInspected(true);
      } else if (uncertain === kind && kind === "profile") setInspected(true);
    } catch {
      setError("Settings could not be checked. Inspect again explicitly.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function change(request: Change) {
    if (!visible || busy.current || acting.pending || uncertain) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setConfirmation(null);
    setInspected(false);
    try {
      const result = await acting.perform(request);
      if (!result.ok) throw new Error(result.error.message);
      let message: string;
      if (request.op === "human-profile-set") {
        const profile = humanProfileSchema.parse(result.data);
        if (
          profile.stationId !== acting.identity!.stationId ||
          profile.actorId !== acting.identity!.actorId ||
          profile.displayName !== request.input.displayName.trim()
        )
          throw new Error("Unsupported human profile result");
        message = "Display name saved.";
      } else if (request.op === "alias-remove") {
        z.object({ state: z.literal("removed") }).parse(result.data);
        message = "Alias removal recorded.";
      } else {
        const value = handleResultSchema.parse(result.data);
        if (
          value.handle.projectId !== acting.projectId ||
          value.handle.targetId !== request.input.targetId ||
          !value.handle.isPrimary ||
          value.normalization.requested !== request.input.name ||
          value.handle.name !== value.normalization.name ||
          value.handle.name !== normalizeName(request.input.name).name
        )
          throw new Error("Unsupported handle result");
        message = `Handle @${value.handle.name} recorded.`;
        if (value.displaced)
          message += ` Previous holder ${value.displaced.targetId} now uses @${value.displaced.fallbackName}.`;
      }
      setConfirmation(message + " Inspect settings for current state.");
    } catch (error) {
      setUncertain(request.op === "human-profile-set" ? "profile" : "handles");
      setUncertainName(
        request.op === "human-profile-set"
          ? null
          : normalizeName(request.input.name).name,
      );
      setObservedHandle(null);
      setError(
        `${error instanceof Error ? error.message : "Unsupported change result."} The change is unconfirmed. Inspect settings before a new change.`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    page,
    profile,
    error,
    confirmation,
    blocked,
    uncertain,
    inspected,
    observedHandle,
    read,
    change,
    canBack: cursors.length > 1,
    next: () => page && read("handles", [...cursors, page.nextCursor]),
    back: () => read("handles", cursors.slice(0, -1)),
    allowNewChange: () => {
      if (blocked || !inspected) return;
      setUncertain(null);
      setUncertainName(null);
      setObservedHandle(null);
      setError(null);
      setInspected(false);
    },
  };
}
