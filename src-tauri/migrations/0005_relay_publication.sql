CREATE TABLE relay_share_drafts (
    draft_id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL
        REFERENCES analysis_snapshots(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL UNIQUE,
    client_publish_id TEXT NOT NULL UNIQUE,
    snapshot_sha256 TEXT NOT NULL,
    title_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    published_at TEXT,
    finalized_sha256 TEXT,
    CHECK ((published_at IS NULL) = (finalized_sha256 IS NULL))
);

CREATE TABLE relay_share_id_maps (
    draft_id TEXT NOT NULL
        REFERENCES relay_share_drafts(draft_id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL
        CHECK (entity_kind IN ('node', 'edge', 'mode', 'node_evidence', 'edge_evidence')),
    source_id TEXT NOT NULL,
    source_index INTEGER NOT NULL DEFAULT -1,
    public_id TEXT NOT NULL,
    PRIMARY KEY (draft_id, entity_kind, source_id, source_index),
    UNIQUE (draft_id, public_id)
);

CREATE TABLE relay_share_publications (
    publication_id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    package_id TEXT NOT NULL UNIQUE,
    client_publish_id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    atlas_version_id TEXT NOT NULL,
    package_sha256 TEXT NOT NULL,
    relay_url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE INDEX idx_relay_share_drafts_snapshot
    ON relay_share_drafts(snapshot_id, created_at DESC);

CREATE INDEX idx_relay_share_publications_published
    ON relay_share_publications(published_at DESC);
