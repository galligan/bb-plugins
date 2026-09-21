// Reads Graphite's metadata database. Never writes to it, and never runs `gt`.
//
// Schema and field semantics: docs/agents/graphite.md.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { StackReadError, type MetadataSchema, type StackIssue } from "./types.ts";

export const METADATA_FILENAME = ".graphite_metadata.db";
export const REPO_CONFIG_FILENAME = ".graphite_repo_config";

/**
 * The migrations every Graphite `1.8.6` database on this machine reports. A database
 * that reports a different set has a schema this reader was not written against.
 */
export const KNOWN_MIGRATIONS: readonly string[] = [
  "20260211_initial_schema",
  "20260212_add_validation_columns",
  "20260220_add_parent_head_revision",
];

/**
 * `gt` writes this database on every invocation, including read commands. Let SQLite
 * wait out a writer rather than failing the caller's command.
 */
const BUSY_TIMEOUT_MS = 2_000;

const SELECT_BRANCHES =
  "select branch_name, parent_branch_name, parent_branch_revision, branch_revision, " +
  "validation_result, children from branch_metadata";

/** One validated metadata row. Fields Graphite left empty arrive as null. */
export interface BranchRecord {
  readonly name: string;
  readonly parent: string | null;
  readonly parentRevision: string | null;
  readonly revision: string | null;
  readonly validation: string | null;
  /** The `children` column as Graphite wrote it. Null when it did not parse. */
  readonly recordedChildren: readonly string[] | null;
}

export interface MetadataRead {
  readonly records: readonly BranchRecord[];
  readonly issues: readonly StackIssue[];
  readonly schema: MetadataSchema;
}

type Cell = { readonly ok: true; readonly value: string | null } | { readonly ok: false };

/** Graphite declares every column `text`. Anything else means the row is not trustworthy. */
function textCell(value: unknown): Cell {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, value: value.length === 0 ? null : value };
}

type ChildrenParse =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: string };

function parseChildren(raw: string | null): ChildrenParse {
  if (raw === null) return { ok: true, names: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "not a JSON array" };
  const names: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry.length === 0) {
      return { ok: false, reason: "contains a non-string entry" };
    }
    names.push(entry);
  }
  return { ok: true, names };
}

function toRecord(
  row: Readonly<Record<string, unknown>>,
  issues: StackIssue[],
): BranchRecord | null {
  const name = textCell(row.branch_name);
  if (!name.ok || name.value === null) {
    issues.push({
      kind: "row_skipped",
      branch: null,
      reason: "branch_name is missing or not text",
    });
    return null;
  }

  const parent = textCell(row.parent_branch_name);
  if (!parent.ok) {
    issues.push({
      kind: "row_skipped",
      branch: name.value,
      reason: "parent_branch_name is not text",
    });
    return null;
  }

  const parentRevision = textCell(row.parent_branch_revision);
  const revision = textCell(row.branch_revision);
  const validation = textCell(row.validation_result);
  const children = textCell(row.children);
  for (const [field, cell] of [
    ["parent_branch_revision", parentRevision],
    ["branch_revision", revision],
    ["validation_result", validation],
    ["children", children],
  ] as const) {
    if (!cell.ok) {
      issues.push({ kind: "malformed_field", branch: name.value, field, reason: "not text" });
    }
  }

  let recordedChildren: readonly string[] | null = null;
  if (children.ok) {
    const parsed = parseChildren(children.value);
    if (parsed.ok) {
      recordedChildren = parsed.names;
    } else {
      issues.push({
        kind: "malformed_field",
        branch: name.value,
        field: "children",
        reason: parsed.reason,
      });
    }
  }

  return {
    name: name.value,
    parent: parent.value,
    parentRevision: parentRevision.ok ? parentRevision.value : null,
    revision: revision.ok ? revision.value : null,
    validation: validation.ok ? validation.value : null,
    recordedChildren,
  };
}

/** Applied migration ids. Empty when the table is absent or unreadable, which is itself a change. */
function readMigrations(database: DatabaseSync): readonly string[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = database.prepare("select name from kysely_migration order by name").all();
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.name === "string") names.push(row.name);
  }
  return names;
}

function checkSchema(migrations: readonly string[]): MetadataSchema {
  const applied = new Set(migrations);
  return {
    migrations,
    unexpected: migrations.filter((name) => !KNOWN_MIGRATIONS.includes(name)),
    missing: KNOWN_MIGRATIONS.filter((name) => !applied.has(name)),
  };
}

/** Reads every branch row. A row the reader cannot trust becomes an issue, not a throw. */
export function readBranchRecords(gitCommonDir: string): MetadataRead {
  const path = join(gitCommonDir, METADATA_FILENAME);
  if (!existsSync(path)) {
    throw new StackReadError("no_graphite_metadata", `no Graphite metadata at ${path}`);
  }

  let rows: Array<Record<string, unknown>>;
  let schema: MetadataSchema;
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  } catch (cause) {
    throw new StackReadError("metadata_unreadable", `cannot open ${path}`, { cause });
  }
  try {
    schema = checkSchema(readMigrations(database));
    rows = database.prepare(SELECT_BRANCHES).all();
  } catch (cause) {
    throw new StackReadError("metadata_unreadable", `cannot read branch_metadata in ${path}`, {
      cause,
    });
  } finally {
    database.close();
  }

  const issues: StackIssue[] = [];
  if (schema.unexpected.length > 0 || schema.missing.length > 0) {
    issues.push({
      kind: "schema_changed",
      unexpected: schema.unexpected,
      missing: schema.missing,
    });
  }
  const records: BranchRecord[] = [];
  for (const row of rows) {
    const record = toRecord(row, issues);
    if (record !== null) records.push(record);
  }
  return { records, issues, schema };
}

/** The trunk branch name Graphite was initialized with. Null when unreadable. */
export function readTrunkName(gitCommonDir: string): string | null {
  const path = join(gitCommonDir, REPO_CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("trunk" in parsed)) return null;
  const trunk: unknown = parsed.trunk;
  return typeof trunk === "string" && trunk.length > 0 ? trunk : null;
}
