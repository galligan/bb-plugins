export const setupMigrations = [
  `CREATE TABLE bot_setup (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id),
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
    request_id TEXT NOT NULL UNIQUE,
    request_json TEXT NOT NULL,
    home_path TEXT,
    project_id TEXT,
    phase TEXT NOT NULL DEFAULT 'planned',
    error TEXT,
    title_revision INTEGER NOT NULL DEFAULT 0
  )`,
];
