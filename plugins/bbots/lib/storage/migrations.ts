import { setupMigrations } from "../setup/migrations.ts";
import { memoryMigrations } from "../memory/provenance.ts";
import { checkpointMigrations } from "../checkpoints/contracts.ts";

// Append only: the public host hashes every indexed statement.
export const migrations = [
  `CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE bot_revisions (
    bot_id TEXT NOT NULL REFERENCES bots(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, revision)
  )`,
  `CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id),
    role TEXT NOT NULL CHECK (role IN ('main', 'worker')),
    thread_id TEXT UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX one_main_per_bot ON conversations(bot_id) WHERE role = 'main'`,
  `CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id),
    name TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    UNIQUE (bot_id, name)
  )`,
  `CREATE TABLE document_revisions (
    document_id TEXT NOT NULL REFERENCES documents(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    markdown TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (document_id, revision)
  )`,
  ...setupMigrations,
  `CREATE TABLE soul_supplied (
    thread_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    supplied_at TEXT NOT NULL
  )`,
  `CREATE TABLE worker_setup (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
    request_id TEXT NOT NULL UNIQUE,
    request_json TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('planned','spawning','bound')),
    error TEXT,
    title_revision INTEGER NOT NULL DEFAULT 0
  )`,
  ...memoryMigrations,
  ...checkpointMigrations,
];
