// Text rendering of a stack snapshot, for the CLI and the agent tool.
//
// Pure, so the two surfaces cannot drift: they render the same value the banner
// draws. Shaped after `gt ls` — tip first, trunk last — because that is the
// arrangement anyone working a stack already reads.

import type { CurrentStack } from "./current-stack.ts";

const MARK_CURRENT = "*";
const MARK_OTHER = " ";

/** One line per branch, offshoots indented under the branch they hang off. */
export function renderStack(stack: CurrentStack): string {
  if (stack.outcome !== "stacked") return `No stack: ${stack.reason}`;

  const lines: string[] = [
    `${stack.branch}  ${stack.position}/${stack.total}` +
      (stack.needsRestack ? "  (needs restack)" : "") +
      (stack.isStale ? "  (drifted)" : "") +
      (stack.workingTree !== null && stack.workingTree !== "clean"
        ? `  (${stack.workingTree})`
        : ""),
    "",
  ];

  for (const warning of stack.warnings) lines.push(`Warning: ${warning}`);
  if (stack.warnings.length > 0) lines.push("");

  for (const branch of [...stack.branches].reverse()) {
    const flags: string[] = [];
    if (branch.needsRestack) flags.push("needs restack");
    for (const thread of branch.threads) flags.push(`thread: ${thread.title}`);
    // Offshoots first, so a column reads upward into the branch it joins, the way
    // `gt ls` prints it and the way the banner draws it.
    for (const offshoot of branch.offshoots) {
      const offshootFlags = offshoot.needsRestack ? "  [needs restack]" : "";
      lines.push(
        `${MARK_OTHER} ${"  ".repeat(offshoot.column)}${offshoot.name}${offshootFlags}`,
      );
    }
    lines.push(
      `${branch.isCurrent ? MARK_CURRENT : MARK_OTHER} ${branch.name}` +
        (flags.length > 0 ? `  [${flags.join(", ")}]` : ""),
    );
  }

  return lines.join("\n");
}
