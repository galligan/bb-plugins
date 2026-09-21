// Test-only helpers. Build a real git repository and a real Graphite metadata
// database, so the reader is exercised against the same shapes Graphite writes.
//
// Not imported by plugin code.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { KNOWN_MIGRATIONS, METADATA_FILENAME, REPO_CONFIG_FILENAME } from "./metadata.ts";

const execFileAsync = promisify(execFile);

/** Graphite's `branch_metadata` schema, copied verbatim from a `gt init` database. */
const CREATE_TABLE =
  'CREATE TABLE "branch_metadata" ("branch_name" text not null primary key, ' +
  '"parent_branch_name" text, "parent_branch_revision" text, ' +
  '"last_submitted_version" text, "state" text, "children" text, ' +
  '"branch_revision" text, "validation_result" text, "parent_head_revision" text)';

const CREATE_MIGRATIONS =
  'CREATE TABLE "kysely_migration" ("name" varchar(255) not null primary key, ' +
  '"timestamp" varchar(255) not null)';

const COLUMNS = [
  "branch_name",
  "parent_branch_name",
  "parent_branch_revision",
  "last_submitted_version",
  "state",
  "children",
  "branch_revision",
  "validation_result",
  "parent_head_revision",
] as const;

/** A raw row. `Uint8Array` is allowed so tests can store a value Graphite never writes. */
export type MetadataRow = Readonly<
  Partial<Record<(typeof COLUMNS)[number], string | number | Uint8Array | null>>
>;

export class Fixture {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async git(...args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", [...args], { cwd: this.path, encoding: "utf8" });
    return stdout.trim();
  }

  /** Commits one file on `branch`, creating the branch off the current HEAD if new. */
  async commit(branch: string, message: string): Promise<string> {
    const existing = await this.git("branch", "--list", branch);
    if (existing === "") await this.git("checkout", "-b", branch);
    else await this.git("checkout", branch);
    writeFileSync(join(this.path, `${branch.replaceAll("/", "-")}.txt`), `${message}\n`, {
      flag: "a",
    });
    await this.git("add", "-A");
    await this.git("commit", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  async head(branch: string): Promise<string> {
    return this.git("rev-parse", branch);
  }

  /** Writes the Graphite metadata database and repo config as `gt` would. */
  writeMetadata(
    rows: readonly MetadataRow[],
    options: {
      readonly trunk?: string | null;
      readonly migrations?: readonly string[];
    } = {},
  ): void {
    const trunk = options.trunk ?? "main";
    const migrations = options.migrations ?? KNOWN_MIGRATIONS;
    const database = new DatabaseSync(join(this.path, ".git", METADATA_FILENAME));
    try {
      database.exec(CREATE_TABLE);
      database.exec(CREATE_MIGRATIONS);
      const recordMigration = database.prepare(
        "insert into kysely_migration (name, timestamp) values (?, ?)",
      );
      for (const name of migrations) {
        recordMigration.run(name, "2026-09-18T00:00:00.000Z");
      }
      const insert = database.prepare(
        `insert into branch_metadata (${COLUMNS.join(", ")}) values (${COLUMNS.map(() => "?").join(", ")})`,
      );
      for (const row of rows) {
        insert.run(...COLUMNS.map((column) => row[column] ?? null));
      }
    } finally {
      database.close();
    }

    if (trunk !== null) {
      writeFileSync(
        join(this.path, ".git", REPO_CONFIG_FILENAME),
        `${JSON.stringify({ trunk, trunks: [{ name: trunk }] }, null, 2)}\n`,
      );
    }
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

/** A repository with one commit on `main` and no Graphite metadata yet. */
export async function createFixture(): Promise<Fixture> {
  const fixture = new Fixture(mkdtempSync(join(tmpdir(), "bb-graphite-stack-")));
  await fixture.git("init", "-b", "main");
  await fixture.git("config", "user.email", "fixture@example.invalid");
  await fixture.git("config", "user.name", "Fixture");
  await fixture.git("config", "commit.gpgsign", "false");
  await fixture.commit("main", "root");
  return fixture;
}
