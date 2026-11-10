import type { Inspection } from "./inspect.ts";
const BRANCH_STATE = {
  "no-commits": "no commits yet",
  merged: "merged into base",
  pushed: "pushed",
  local: "local only",
  detached: "detached HEAD",
};
export function branchDescription(inspection: Inspection): string {
  return inspection.branchState === "local"
    ? `${BRANCH_STATE.local} (${String(inspection.unpushedCommits)} unpushed)`
    : BRANCH_STATE[inspection.branchState];
}
