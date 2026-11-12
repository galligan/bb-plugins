import type { z } from "zod";
import { checkpointRequest } from "../../lib/ui/checkpoint-contracts.ts";

export type CheckpointRequest = z.infer<typeof checkpointRequest>;
export const checkpointRequestKey = (botId: string) =>
  `bbots.checkpoint.${botId}`;
export const checkpointRequestEvent = "bbots:checkpoint-request";

export function readCheckpointRequest(botId: string): CheckpointRequest | null {
  const raw = sessionStorage.getItem(checkpointRequestKey(botId));
  if (raw === null) return null;
  const value = checkpointRequest.parse(JSON.parse(raw));
  if (value.expectedBotId !== botId)
    throw new Error("The retained checkpoint request belongs to another bot.");
  return value;
}

export function retainCheckpointRequest(value: CheckpointRequest) {
  // Other mounted records views share this browser tab's session storage.
  if (readCheckpointRequest(value.expectedBotId))
    throw new Error(
      "Inspect the existing retained request before creating another checkpoint.",
    );
  sessionStorage.setItem(
    checkpointRequestKey(value.expectedBotId),
    JSON.stringify(checkpointRequest.parse(value)),
  );
  window.dispatchEvent(new Event(checkpointRequestEvent));
}

export function clearCheckpointRequest(value: CheckpointRequest) {
  const current = readCheckpointRequest(value.expectedBotId);
  if (JSON.stringify(current) !== JSON.stringify(value))
    throw new Error(
      "The retained checkpoint request changed. Preserve and inspect it.",
    );
  sessionStorage.removeItem(checkpointRequestKey(value.expectedBotId));
  window.dispatchEvent(new Event(checkpointRequestEvent));
}
