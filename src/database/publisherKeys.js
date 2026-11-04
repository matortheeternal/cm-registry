import { getDatabase } from './connection.js';

export function findPublicKey(fingerprint) {
    return getDatabase().get(
        'SELECT public_key FROM publisher_keys WHERE fingerprint=?',
        fingerprint
    );
}

export function findWithPublisherState(fingerprint) {
    return getDatabase().get(
        `SELECT k.*, p.state publisher_state
            FROM publisher_keys k
            JOIN publishers p
            ON p.id = k.publisher_id
            WHERE fingerprint = ?`,
        fingerprint
    );
}

export function exists(fingerprint) {
    return Boolean(
        getDatabase().get('SELECT 1 FROM publisher_keys WHERE fingerprint=?', fingerprint)
    );
}

export function findRevocation(fingerprint) {
    return getDatabase().get(
        'SELECT revoked FROM publisher_keys WHERE fingerprint=?',
        fingerprint
    );
}

export function listRecent() {
    return getDatabase().all(
        'SELECT * FROM publisher_keys ORDER BY created DESC, rowid DESC LIMIT 1000'
    );
}

export function createInitial({ fingerprint, publisherId, publicKey }) {
    return getDatabase().run(
        `INSERT INTO publisher_keys (fingerprint, publisher_id, public_key)
            VALUES (?, ?, ?)`,
        fingerprint,
        publisherId,
        publicKey
    );
}

export function revoke({ revoked, fingerprint }) {
    return getDatabase().run(
        'UPDATE publisher_keys SET revoked=COALESCE(revoked,?) WHERE fingerprint=?',
        revoked,
        fingerprint
    );
}

export function create({ fingerprint, publisherId, publicKey, label }) {
    return getDatabase().run(
        `INSERT INTO publisher_keys (fingerprint, publisher_id, public_key,
            label)
            VALUES (?, ?, ?, ?)`,
        fingerprint,
        publisherId,
        publicKey,
        label
    );
}

export function findOwned(fingerprint, publisherId) {
    return getDatabase().get(
        'SELECT * FROM publisher_keys WHERE fingerprint=? AND publisher_id=?',
        fingerprint,
        publisherId
    );
}
