export const DEFAULT_RETIRE_GRACE_MINUTES = 30;

/**
 * How long bb waits, once no thread holds a worktree's environment, before
 * asking for its removal. Null keeps the worktree until it is deleted by hand.
 */
export function retireGraceMs(settings: {
  enabled: boolean;
  minutes: number;
}): number | null {
  return settings.enabled ? Math.round(settings.minutes * 60_000) : null;
}

export function isValidGraceMinutes(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
