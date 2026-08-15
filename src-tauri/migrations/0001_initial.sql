PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_path TEXT,
    source_sha256 TEXT,
    analyze_redacted INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sequence_index INTEGER NOT NULL,
    speaker TEXT NOT NULL,
    phase TEXT,
    external_message_id TEXT,
    source_event_index INTEGER,
    text TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    redacted_text TEXT NOT NULL,
    redaction_map_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(conversation_id, sequence_index)
);

CREATE TABLE IF NOT EXISTS visible_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    speaker TEXT NOT NULL,
    operation_only INTEGER NOT NULL DEFAULT 0,
    UNIQUE(conversation_id, ordinal)
);

CREATE TABLE IF NOT EXISTS turn_messages (
    turn_id TEXT NOT NULL REFERENCES visible_turns(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES source_messages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY(turn_id, message_id)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    error_message TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_events (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES analysis_snapshots(id) ON DELETE CASCADE,
    command_json TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS layout_states (
    snapshot_id TEXT PRIMARY KEY REFERENCES analysis_snapshots(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON source_messages(conversation_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_turns_conversation ON visible_turns(conversation_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_runs_conversation ON analysis_runs(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_run ON analysis_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_corrections_snapshot ON correction_events(snapshot_id, created_at, id);
