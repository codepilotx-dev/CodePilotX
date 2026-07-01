CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    transcript_path TEXT NOT NULL,
    rollout_path TEXT,

    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    recency_at_ms INTEGER NOT NULL DEFAULT 0,

    title TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,

    archived INTEGER NOT NULL DEFAULT 0,
    archived_at_ms INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    session_mode TEXT NOT NULL DEFAULT 'normal',
    source TEXT NOT NULL DEFAULT 'desktop',
    is_sidechain INTEGER NOT NULL DEFAULT 0,

    model_provider TEXT,
    model TEXT,
    thinking_mode TEXT,
    approval_mode TEXT,

    git_branch TEXT,
    git_sha TEXT,
    git_origin_url TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    pr_repository TEXT,

    app_version TEXT,
    tags TEXT,
    summary TEXT,
    parent_session_id TEXT,
    subagent_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_created
    ON sessions(created_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_updated
    ON sessions(updated_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_recency
    ON sessions(recency_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_archived_created
    ON sessions(archived, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_archived_updated
    ON sessions(archived, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_archived_recency
    ON sessions(archived, recency_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project_created
    ON sessions(project_path, archived, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project_recency
    ON sessions(project_path, archived, recency_at_ms DESC);

-- Partial indexes: only include sessions with a non-empty preview
-- (the "visible" set). Dramatically reduces index size for listing queries.
CREATE INDEX IF NOT EXISTS idx_sessions_visible_created
    ON sessions(archived, created_at_ms DESC)
    WHERE preview <> '';

CREATE INDEX IF NOT EXISTS idx_sessions_visible_updated
    ON sessions(archived, updated_at_ms DESC)
    WHERE preview <> '';

CREATE INDEX IF NOT EXISTS idx_sessions_visible_recency
    ON sessions(archived, recency_at_ms DESC)
    WHERE preview <> '';
