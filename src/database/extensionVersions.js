import { getDatabase } from './connection.js';

export function listRecent() {
    return getDatabase().all(
        'SELECT * FROM extension_versions ORDER BY published DESC LIMIT 1000'
    );
}

export function listForExtension(extensionId) {
    return getDatabase().all(
        'SELECT * FROM extension_versions WHERE extension_id=?',
        extensionId
    );
}

export function findVersion(extensionId, version) {
    return getDatabase().get(
        'SELECT * FROM extension_versions WHERE extension_id=? AND version=?',
        extensionId,
        version
    );
}

export function findBySubmission(submissionId) {
    return getDatabase().get(
        'SELECT * FROM extension_versions WHERE submission_id=?',
        submissionId
    );
}

export function exists(extensionId, version) {
    return Boolean(
        getDatabase().get(
            'SELECT 1 FROM extension_versions WHERE extension_id=? AND version=?',
            extensionId,
            version
        )
    );
}

export function create({
    extensionId,
    version,
    submissionId,
    metadata,
    objectKey,
    sha256,
    size,
    published
}) {
    return getDatabase().run(
        `INSERT INTO extension_versions (
                extension_id, version, submission_id, metadata,
                object_key, sha256, size, published
            )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        extensionId,
        version,
        submissionId,
        metadata,
        objectKey,
        sha256,
        size,
        published
    );
}

export function listPublishedMetadata(extensionId) {
    return getDatabase().all(
        `SELECT version, metadata
            FROM extension_versions
            WHERE extension_id = ?
            AND state = 'published'`,
        extensionId
    );
}

export function findState(extensionId, version) {
    return getDatabase().get(
        'SELECT state FROM extension_versions WHERE extension_id=? AND version=?',
        extensionId,
        version
    );
}

export function setState({ state, notes, extensionId, version }) {
    return getDatabase().run(
        `UPDATE extension_versions
            SET state = ?, notes = ?
            WHERE extension_id = ?
            AND version = ?`,
        state,
        notes,
        extensionId,
        version
    );
}
