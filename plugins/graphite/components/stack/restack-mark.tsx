// One orange mark beside a branch name, rather than the words repeated down the
// right edge of every row.

/** Orange mark beside a branch name. Replaces the "needs restack" text on every row. */
export function RestackMark() {
  return (
    <span
      title="Needs restack"
      aria-label="Needs restack"
      role="img"
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-warning-text text-2xs font-semibold leading-none text-warning-text"
    >
      !
    </span>
  );
}
