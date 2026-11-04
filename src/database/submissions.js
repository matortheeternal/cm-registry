import { getDatabase } from './connection.js';

export function listRecent() {
    return getDatabase().all('SELECT * FROM submissions ORDER BY created DESC, rowid DESC LIMIT 500');
}

export function findById(id) {
    return getDatabase().get('SELECT * FROM submissions WHERE id=?', id);
}

export function reject({ notes, reviewedBy, id }) {
    return getDatabase().run(
        'UPDATE submissions SET state=\'rejected\',notes=?,reviewed_by=? WHERE id=?',
        notes,
        reviewedBy,
        id
    );
}

export function approve({ notes, reviewedBy, id }) {
    return getDatabase().run(
        'UPDATE submissions SET state=\'approved\',notes=?,reviewed_by=? WHERE id=?',
        notes,
        reviewedBy,
        id
    );
}

export function findRetry(publisherId, idempotencyKey) {
    return getDatabase().get(
        'SELECT * FROM submissions WHERE publisher_id=? AND idempotency_key=?',
        publisherId,
        idempotencyKey
    );
}

export function countOutstanding(publisherId) {
    return getDatabase().get(
        `SELECT count(*) count
            FROM submissions
            WHERE publisher_id = ?
            AND state IN ('awaiting_upload', 'pending_review')`,
        publisherId
    ).count;
}

export function create({
    id,
    publisherId,
    extensionId,
    version,
    type,
    expectedHash,
    size,
    idempotencyKey,
    requestHash,
    expires
}) {
    return getDatabase().run(
        `INSERT INTO submissions (id, publisher_id, extension_id, version,
            type, expected_hash, size, idempotency_key, request_hash,
            expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        publisherId,
        extensionId,
        version,
        type,
        expectedHash,
        size,
        idempotencyKey,
        requestHash,
        expires
    );
}

export function listForPublisher(publisherId) {
    return getDatabase().all(
        `SELECT * FROM submissions WHERE publisher_id=? ORDER BY created DESC, rowid DESC LIMIT 100`,
        publisherId
    );
}

export function finalize({ metadata, verifiedHash, id }) {
    return getDatabase().run(
        `UPDATE submissions
            SET state = 'pending_review', metadata = ?, verified_hash = ?
            WHERE id = ?`,
        metadata,
        verifiedHash,
        id
    );
}

export function withdraw({ id }) {
    return getDatabase().run('UPDATE submissions SET state=\'withdrawn\' WHERE id=?', id);
}

export function findReservation(extensionId) {
    return getDatabase().get(
        `SELECT publisher_id, type
            FROM submissions
            WHERE extension_id = ?
            AND state IN ('awaiting_upload', 'pending_review', 'approved')
            LIMIT 1`,
        extensionId
    );
}

export function listExpiredUploads(before) {
    return getDatabase().all(
        'SELECT id FROM submissions WHERE state=\'awaiting_upload\' AND expires<?',
        before
    );
}

export function expireUploads({ before }) {
    return getDatabase().run(
        `UPDATE submissions SET state='withdrawn',notes='Expired upload'
            WHERE state='awaiting_upload' AND expires<?`,
        before
    );
}

export function listDiscarded() {
    return getDatabase().all(
        'SELECT id FROM submissions WHERE state IN (\'withdrawn\',\'rejected\')'
    );
}
