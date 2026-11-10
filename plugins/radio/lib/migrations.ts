// Shipped statement positions and contents are immutable. Append only.
export const MIGRATIONS = [
  `CREATE TABLE station (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    id TEXT NOT NULL UNIQUE CHECK(length(id) > 0)
  ) STRICT`,
  `CREATE TABLE participants (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('human', 'actor', 'bb-thread', 'external-session')),
    actor_id TEXT REFERENCES participants(id),
    principal_id TEXT,
    external_id TEXT,
    metadata_json TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK(provenance IN ('station', 'bb', 'self-reported')),
    CHECK((kind IN ('human', 'actor') AND actor_id IS NULL AND external_id IS NULL)
       OR (kind = 'bb-thread' AND actor_id IS NOT NULL AND principal_id IS NULL AND external_id IS NULL)
       OR (kind = 'external-session' AND actor_id IS NOT NULL AND principal_id IS NOT NULL)),
    CHECK(kind != 'human' OR principal_id IS NULL)
  ) STRICT`,
  `CREATE UNIQUE INDEX one_human ON participants(kind) WHERE kind = 'human'`,
  `CREATE UNIQUE INDEX principal_actor ON participants(principal_id) WHERE kind = 'actor' AND principal_id IS NOT NULL`,
  `CREATE UNIQUE INDEX external_session_key ON participants(principal_id, external_id) WHERE kind = 'external-session' AND external_id IS NOT NULL`,
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 64
      AND name NOT GLOB '*[^a-z0-9-]*' AND name NOT LIKE '%--%'
      AND substr(name, 1, 1) != '-' AND substr(name, -1) != '-')
  ) STRICT`,
  `CREATE TABLE channels (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    parent_id TEXT REFERENCES channels(id),
    name TEXT NOT NULL,
    UNIQUE(project_id, name),
    CHECK((parent_id IS NULL AND name = '') OR (parent_id IS NOT NULL AND length(name) BETWEEN 1 AND 64
      AND name NOT GLOB '*[^a-z0-9-]*' AND name NOT LIKE '%--%'
      AND substr(name, 1, 1) != '-' AND substr(name, -1) != '-'))
  ) STRICT`,
];
