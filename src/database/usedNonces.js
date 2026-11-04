import { getDatabase } from './connection.js';

export function pruneExpired({ before }) {
    return getDatabase().run('DELETE FROM used_nonces WHERE expires < ?', before);
}

export function consume({ keyId, nonce, expires }) {
    return getDatabase().run(
        'INSERT OR IGNORE INTO used_nonces(key_id,nonce,expires) VALUES(?,?,?)',
        keyId,
        nonce,
        expires
    );
}
