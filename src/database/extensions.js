import { getDatabase } from './connection.js';

export function findPublic(id) {
    return getDatabase().get(
        `SELECT e.* FROM extensions e
            WHERE id = ? AND EXISTS (
                SELECT 1 FROM extension_versions v
                WHERE v.extension_id = e.id
            )`,
        id
    );
}

export function searchPublished({ type, query, limit, offset }) {
    return getDatabase().all(
        `SELECT e.* FROM extensions e
            WHERE (? = '' OR type = ?)
                AND (instr(lower(e.id), lower(?)) > 0
                    OR instr(lower(e.metadata), lower(?)) > 0)
                AND EXISTS (
                    SELECT 1 FROM extension_versions v
                    WHERE v.extension_id = e.id AND v.state = 'published'
                )
            ORDER BY e.id
            LIMIT ? OFFSET ?`,
        type,
        type,
        query,
        query,
        limit,
        offset
    );
}

export function createIfAbsent({ id, publisherId, type, metadata }) {
    return getDatabase().run(
        `INSERT INTO extensions (id, publisher_id, type, metadata)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`,
        id,
        publisherId,
        type,
        metadata
    );
}

export function updateMetadata({ metadata, id }) {
    return getDatabase().run('UPDATE extensions SET metadata=? WHERE id=?', metadata, id);
}

export function findById(id) {
    return getDatabase().get('SELECT * FROM extensions WHERE id=?', id);
}
