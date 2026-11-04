import { getDatabase } from './connection.js';

export function listRecent() {
    return getDatabase().all('SELECT * FROM publishers ORDER BY created DESC, rowid DESC LIMIT 500');
}

export function create({ id, displayName, email }) {
    return getDatabase().run(
        'INSERT INTO publishers(id,display_name,email) VALUES(?,?,?)',
        id,
        displayName,
        email
    );
}

export function setState({ state, id }) {
    return getDatabase().run('UPDATE publishers SET state=? WHERE id=?', state, id);
}

export function exists(id) {
    return Boolean(getDatabase().get('SELECT 1 FROM publishers WHERE id=?', id));
}

export function findState(id) {
    return getDatabase().get('SELECT state FROM publishers WHERE id=?', id);
}
