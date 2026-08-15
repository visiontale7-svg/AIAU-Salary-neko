ALTER TABLE analysis_runs
ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'openai_api';

ALTER TABLE analysis_runs
ADD COLUMN provider_version TEXT;

ALTER TABLE analysis_runs
ADD COLUMN credential_mode TEXT;

CREATE TABLE IF NOT EXISTS app_settings (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    analysis_provider TEXT NOT NULL DEFAULT 'openai_api'
        CHECK (analysis_provider IN ('openai_api', 'codex_cli')),
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (singleton_id, analysis_provider, updated_at)
VALUES (1, 'openai_api', CURRENT_TIMESTAMP);
