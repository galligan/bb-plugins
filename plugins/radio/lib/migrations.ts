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
  `CREATE TABLE handles (
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64 AND name NOT IN ('user', 'ch')
      AND name NOT GLOB '*[^a-z0-9-]*' AND name NOT LIKE '%--%'
      AND substr(name, 1, 1) != '-' AND substr(name, -1) != '-'),
    target_id TEXT NOT NULL REFERENCES participants(id),
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
    PRIMARY KEY(project_id, name)
  ) STRICT`,
  `CREATE UNIQUE INDEX primary_handle ON handles(project_id, target_id) WHERE is_primary = 1`,
  `CREATE TABLE handle_reassignments (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    human_id TEXT NOT NULL REFERENCES participants(id),
    target_id TEXT NOT NULL REFERENCES participants(id),
    name TEXT NOT NULL,
    displaced_id TEXT REFERENCES participants(id),
    fallback_name TEXT
  ) STRICT`,
  `CREATE TABLE transmissions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    author_id TEXT NOT NULL REFERENCES participants(id),
    session_id TEXT REFERENCES participants(id),
    channel_id TEXT NOT NULL REFERENCES channels(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reply_to_id TEXT REFERENCES transmissions(id),
    refs_json TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    tokens_json TEXT NOT NULL,
    caller_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    UNIQUE(caller_key, idempotency_key)
  ) STRICT`,
  `CREATE INDEX transmission_channel_cursor ON transmissions(channel_id, seq)`,
  `CREATE TABLE transmission_recipients (
    tx_id TEXT NOT NULL REFERENCES transmissions(id),
    target_id TEXT NOT NULL REFERENCES participants(id),
    PRIMARY KEY(tx_id, target_id)
  ) STRICT`,
  `CREATE TABLE dispatches (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    author_id TEXT NOT NULL REFERENCES participants(id),
    latest INTEGER NOT NULL CHECK(latest > 0)
  ) STRICT`,
  `CREATE TABLE dispatch_revisions (
    dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    title TEXT NOT NULL,
    markdown TEXT NOT NULL,
    editor_id TEXT NOT NULL REFERENCES participants(id),
    session_id TEXT REFERENCES participants(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(dispatch_id, revision)
  ) STRICT`,
  `CREATE TABLE dispatch_requests (
    caller_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create', 'revise')),
    request_json TEXT NOT NULL,
    dispatch_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY(caller_key, idempotency_key),
    FOREIGN KEY(dispatch_id, revision) REFERENCES dispatch_revisions(dispatch_id, revision)
  ) STRICT`,
  `CREATE INDEX dispatch_channel_cursor ON dispatches(channel_id, seq)`,
  `CREATE TABLE response_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    tx_id TEXT NOT NULL REFERENCES transmissions(id),
    target_id TEXT NOT NULL REFERENCES participants(id),
    actor_id TEXT NOT NULL REFERENCES participants(id),
    session_id TEXT REFERENCES participants(id),
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE INDEX response_tx_cursor ON response_events(tx_id, seq)`,
  `CREATE TABLE receipt_confirmations (
    tx_id TEXT NOT NULL REFERENCES transmissions(id),
    target_id TEXT NOT NULL REFERENCES participants(id),
    endpoint_id TEXT NOT NULL REFERENCES participants(id),
    event_id TEXT NOT NULL REFERENCES response_events(id),
    PRIMARY KEY(tx_id, target_id, endpoint_id)
  ) STRICT`,
  `CREATE TABLE protocol_requests (
    caller_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES response_events(id),
    PRIMARY KEY(caller_key, idempotency_key)
  ) STRICT`,
  `ALTER TABLE transmissions ADD COLUMN request_mode TEXT NOT NULL DEFAULT 'discussion' CHECK(request_mode IN ('discussion', 'exclusive'))`,
  `ALTER TABLE transmissions ADD COLUMN require_ack INTEGER NOT NULL DEFAULT 0 CHECK(require_ack IN (0, 1))`,
  `ALTER TABLE transmissions ADD COLUMN expect_reply INTEGER NOT NULL DEFAULT 0 CHECK(expect_reply IN (0, 1))`,
  `CREATE TABLE commitments (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    tx_id TEXT NOT NULL REFERENCES transmissions(id),
    target_id TEXT NOT NULL REFERENCES participants(id),
    owner_actor_id TEXT NOT NULL REFERENCES participants(id),
    opening_session_id TEXT REFERENCES participants(id),
    generation INTEGER NOT NULL CHECK(generation >= 0),
    status TEXT NOT NULL CHECK(status IN ('open', 'done', 'abandoned')),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    result TEXT,
    reason TEXT,
    UNIQUE(tx_id, target_id, generation)
  ) STRICT`,
  `CREATE TABLE exclusive_claims (
    tx_id TEXT PRIMARY KEY NOT NULL REFERENCES transmissions(id),
    generation INTEGER NOT NULL CHECK(generation > 0),
    commitment_id TEXT UNIQUE REFERENCES commitments(id)
  ) STRICT`,
  `CREATE TABLE commitment_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    tx_id TEXT NOT NULL REFERENCES transmissions(id),
    commitment_id TEXT NOT NULL REFERENCES commitments(id),
    actor_id TEXT NOT NULL REFERENCES participants(id),
    session_id TEXT REFERENCES participants(id),
    kind TEXT NOT NULL CHECK(kind IN ('wilco', 'done', 'abandon', 'reopen')),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE commitment_requests (
    caller_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES commitment_events(id),
    result_json TEXT NOT NULL,
    PRIMARY KEY(caller_key, idempotency_key)
  ) STRICT`,
  `CREATE INDEX commitment_owner_cursor ON commitments(owner_actor_id, status, seq)`,
  `CREATE INDEX commitment_tx_events ON commitment_events(tx_id, seq)`,
];
