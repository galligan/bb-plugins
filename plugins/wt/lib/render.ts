import type { ListedWorktree } from "./host-contract.ts";

/** "just now", "5h ago", "3d ago": coarse on purpose, for scanning a list. */
export function age(timestamp: number | null, now: number): string {
  if (timestamp === null) return "unknown";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

const BRANCH_STATE = {
  "no-commits": "no commits yet",
  merged: "merged into base",
  pushed: "pushed",
  local: "local only",
  detached: "detached HEAD",
} as const;

/** One worktree as a short block of text for `bb wt list`. */
export function renderWorktree(entry: ListedWorktree, now: number): string {
  if (entry.status === "missing") {
    return `GONE     ${entry.path}\n         the folder no longer exists`;
  }
  if (entry.status === "unreadable") {
    return `UNKNOWN  ${entry.path}\n         ${entry.message}`;
  }
  const { inspection } = entry;
  const branch =
    inspection.branchState === "local"
      ? `${BRANCH_STATE.local} (${String(inspection.unpushedCommits)} unpushed)`
      : BRANCH_STATE[inspection.branchState];
  const lines = [
    `${inspection.safeToRemove ? "SAFE   " : "UNSAVED"}  ${inspection.path}`,
    `         branch ${inspection.branch ?? "(detached)"}: ${branch}; last activity ${age(inspection.lastActivity, now)}`,
    ...inspection.reasons.map((reason) => `         - ${reason}`),
  ];
  return lines.join("\n");
}
