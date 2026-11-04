PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    description TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'approved', 'rejected')),
    publisher_id TEXT REFERENCES publishers(id),
    notes TEXT,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS publishers (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'suspended')),
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS publisher_keys (
    fingerprint TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES publishers(id),
    public_key TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    revoked INTEGER,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extensions (
    id TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES publishers(id),
    type TEXT NOT NULL CHECK (type IN ('cardpart', 'exporter', 'template', 'game')),
    metadata TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES publishers(id),
    extension_id TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    expected_hash TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0),
    metadata TEXT,
    state TEXT NOT NULL DEFAULT 'awaiting_upload'
        CHECK (state IN (
            'awaiting_upload', 'pending_review', 'approved', 'rejected', 'withdrawn'
        )),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires INTEGER NOT NULL,
    verified_hash TEXT,
    notes TEXT,
    reviewed_by TEXT,
    UNIQUE (publisher_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS reserved_versions
    ON submissions(extension_id, version)
    WHERE state IN ('awaiting_upload', 'pending_review', 'approved');

CREATE TABLE IF NOT EXISTS extension_versions (
    extension_id TEXT NOT NULL REFERENCES extensions(id),
    version TEXT NOT NULL,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
    metadata TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'published'
        CHECK (state IN ('published', 'deprecated', 'revoked')),
    published INTEGER NOT NULL,
    notes TEXT,
    PRIMARY KEY (extension_id, version)
);

CREATE TRIGGER IF NOT EXISTS immutable_release
    BEFORE UPDATE OF extension_id, version, submission_id, metadata,
        object_key, sha256, size, published
    ON extension_versions
BEGIN
    SELECT RAISE(ABORT, 'Release content is immutable');
END;

CREATE TRIGGER IF NOT EXISTS no_delete_release
    BEFORE DELETE ON extension_versions
BEGIN
    SELECT RAISE(ABORT, 'Release records are permanent');
END;

CREATE TABLE IF NOT EXISTS used_nonces (
    key_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires INTEGER NOT NULL,
    PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS nonce_expiry ON used_nonces(expires);

CREATE TABLE IF NOT EXISTS rate_limits (
    scope TEXT NOT NULL,
    window INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (scope, window)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
