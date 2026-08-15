ALTER TABLE codex_session_index ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK (session_kind IN ('primary', 'internal', 'unknown'));

CREATE INDEX idx_codex_session_kind
    ON codex_session_index(session_kind, last_activity_at_utc);
