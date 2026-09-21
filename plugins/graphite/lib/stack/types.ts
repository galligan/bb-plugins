// Shape of the stack snapshot the reader produces.
//
// See docs/agents/graphite.md for where each recorded field comes from and what
// Graphite writes into it.

/** A branch Graphite has a metadata row for, joined with the repository's real state. */
export interface StackBranch {
  readonly name: string;
  /** `parent_branch_name`. Null on trunk and on a branch Graphite has seen but does not track. */
  readonly parent: string | null;
  /** Branches whose recorded parent is this branch. Derived, not read from `children`. */
  readonly children: readonly string[];
  /** True when the name matches the `trunk` field of `.graphite_repo_config`. */
  readonly isTrunk: boolean;
  /** `branch_revision` — the head Graphite last observed. */
  readonly recordedRevision: string | null;
  /** The head git reports now. Null when no `refs/heads/<name>` exists. */
  readonly actualHead: string | null;
  /** Graphite's recorded head disagrees with the repository. Graphite cannot report this. */
  readonly isStale: boolean;
  /** `parent_branch_revision` disagrees with the parent's actual head. */
  readonly needsRestack: boolean;
  /** `validation_result`, carried raw. Not an exhaustive enum. */
  readonly validation: string | null;
}

/** Something the reader refused to trust, recorded instead of thrown. */
export type StackIssue =
  | { readonly kind: "row_skipped"; readonly branch: string | null; readonly reason: string }
  | { readonly kind: "malformed_field"; readonly branch: string; readonly field: string; readonly reason: string }
  | { readonly kind: "missing_parent"; readonly branch: string; readonly parent: string }
  | { readonly kind: "missing_branch"; readonly branch: string }
  | {
      readonly kind: "children_mismatch";
      readonly branch: string;
      readonly recorded: readonly string[];
      readonly derived: readonly string[];
    }
  | { readonly kind: "cycle"; readonly branches: readonly string[] }
  | {
      readonly kind: "schema_changed";
      readonly unexpected: readonly string[];
      readonly missing: readonly string[];
    };

/** Which Graphite migrations the database reports, against the set this reader was written for. */
export interface MetadataSchema {
  /** Applied migration ids. Empty when `kysely_migration` could not be read. */
  readonly migrations: readonly string[];
  /** Applied migrations this reader does not know about. */
  readonly unexpected: readonly string[];
  /** Migrations this reader expects and did not find. */
  readonly missing: readonly string[];
}

export interface StackSnapshot {
  /** Absolute path to the repository's common git directory. */
  readonly gitCommonDir: string;
  /** The `trunk` field of `.graphite_repo_config`, or null when the file has none. */
  readonly trunk: string | null;
  /**
   * Graphite's schema as this database reports it. A non-empty `unexpected` or
   * `missing` means Graphite changed its storage: trust the snapshot less, and
   * re-verify docs/agents/graphite.md.
   */
  readonly schema: MetadataSchema;
  /** Every branch with a metadata row that survived validation, sorted by name. */
  readonly branches: readonly StackBranch[];
  /** Branches with no parent inside the snapshot. Members of a cycle are not roots. */
  readonly roots: readonly string[];
  /** Each detected parent cycle, as the branch names that form it. */
  readonly cycles: readonly (readonly string[])[];
  readonly issues: readonly StackIssue[];
}

export type StackReadErrorCode =
  | "not_a_repository"
  | "no_graphite_metadata"
  | "metadata_unreadable";

/** Thrown only when no snapshot can be produced at all. Per-branch problems become issues. */
export class StackReadError extends Error {
  readonly code: StackReadErrorCode;

  constructor(code: StackReadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StackReadError";
    this.code = code;
  }
}
