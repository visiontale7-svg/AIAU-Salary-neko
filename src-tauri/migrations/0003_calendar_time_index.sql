ALTER TABLE source_messages ADD COLUMN occurred_at_utc TEXT;
ALTER TABLE source_messages ADD COLUMN occurred_at_raw TEXT;
ALTER TABLE source_messages ADD COLUMN external_turn_id TEXT;
ALTER TABLE source_messages ADD COLUMN time_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (time_status IN ('valid', 'missing', 'invalid'));

ALTER TABLE conversations ADD COLUMN source_format TEXT NOT NULL DEFAULT 'legacy_unknown'
    CHECK (source_format IN ('raw_rollout', 'visible_export', 'paste', 'legacy_unknown'));
ALTER TABLE conversations ADD COLUMN external_session_id TEXT;
ALTER TABLE conversations ADD COLUMN imported_first_visible_at_utc TEXT;
ALTER TABLE conversations ADD COLUMN imported_last_activity_at_utc TEXT;
ALTER TABLE conversations ADD COLUMN imported_last_completed_at_utc TEXT;
ALTER TABLE conversations ADD COLUMN imported_last_message_id TEXT;
ALTER TABLE conversations ADD COLUMN imported_time_coverage TEXT NOT NULL DEFAULT 'none'
    CHECK (imported_time_coverage IN ('complete', 'partial', 'none'));
ALTER TABLE conversations ADD COLUMN source_file_size INTEGER;
ALTER TABLE conversations ADD COLUMN source_file_mtime_ns INTEGER;
ALTER TABLE conversations ADD COLUMN supersedes_conversation_id TEXT
    REFERENCES conversations(id);

CREATE TABLE codex_session_index (
    session_id TEXT PRIMARY KEY,
    canonical_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    last_activity_at_utc TEXT,
    last_completed_at_utc TEXT,
    last_message_id TEXT,
    source_state TEXT NOT NULL
        CHECK (source_state IN ('active', 'archived', 'missing')),
    source_file_size INTEGER NOT NULL,
    source_file_mtime_ns INTEGER NOT NULL,
    scan_status TEXT NOT NULL
        CHECK (scan_status IN ('ready', 'partial', 'failed')),
    session_id_inferred INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE conversation_source_versions (
    external_session_id TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    conversation_id TEXT NOT NULL UNIQUE
        REFERENCES conversations(id) ON DELETE CASCADE,
    source_file_size INTEGER,
    source_file_mtime_ns INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (external_session_id, source_sha256)
);

CREATE INDEX idx_source_messages_occurred_at
    ON source_messages(conversation_id, occurred_at_utc);
CREATE INDEX idx_conversations_calendar_time
    ON conversations(imported_last_activity_at_utc);
CREATE INDEX idx_conversations_external_session
    ON conversations(external_session_id, created_at);
CREATE INDEX idx_codex_session_calendar_time
    ON codex_session_index(last_activity_at_utc);
CREATE INDEX idx_conversation_source_versions_session
    ON conversation_source_versions(external_session_id, created_at);
