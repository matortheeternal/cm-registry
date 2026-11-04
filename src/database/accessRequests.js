import { getDatabase } from './connection.js';

export function findPublicKey(fingerprint) {
    return getDatabase().get(
        'SELECT public_key FROM access_requests WHERE fingerprint=?',
        fingerprint
    );
}

export function findState(fingerprint) {
    return getDatabase().get(
        'SELECT state FROM access_requests WHERE fingerprint=?',
        fingerprint
    );
}

export function findSummary(fingerprint) {
    return getDatabase().get(
        'SELECT id,state,notes FROM access_requests WHERE fingerprint=?',
        fingerprint
    );
}

export function countPending() {
    return getDatabase().get(
        'SELECT count(*) count FROM access_requests WHERE state=\'pending\''
    ).count;
}

export function create({
    id,
    fingerprint,
    publicKey,
    displayName,
    email,
    description
}) {
    return getDatabase().run(
        `INSERT INTO access_requests (id, fingerprint, public_key,
            display_name, email, description)
            VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        fingerprint,
        publicKey,
        displayName,
        email,
        description
    );
}

export function findStatus(id, fingerprint) {
    return getDatabase().get(
        `SELECT id, state, publisher_id, notes
            FROM access_requests
            WHERE id = ?
            AND fingerprint = ?`,
        id,
        fingerprint
    );
}

export function listRecent() {
    return getDatabase().all(
        'SELECT * FROM access_requests ORDER BY created DESC, rowid DESC LIMIT 500'
    );
}

export function findById(id) {
    return getDatabase().get('SELECT * FROM access_requests WHERE id=?', id);
}

export function review({ state, publisherId, notes, id }) {
    return getDatabase().run(
        'UPDATE access_requests SET state=?,publisher_id=?,notes=? WHERE id=?',
        state,
        publisherId,
        notes,
        id
    );
}

export function exists(fingerprint) {
    return Boolean(
        getDatabase().get(
            'SELECT 1 FROM access_requests WHERE fingerprint=?',
            fingerprint
        )
    );
}
