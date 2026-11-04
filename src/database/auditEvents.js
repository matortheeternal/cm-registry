import { getDatabase } from './connection.js';

export function listRecent() {
    return getDatabase().all('SELECT * FROM audit_events ORDER BY id DESC LIMIT 200');
}

export function record(actor, action, target, details = {}) {
    return getDatabase().run(
        `INSERT INTO audit_events (actor, action, target, details)
            VALUES (?, ?, ?, ?)`,
        actor,
        action,
        target,
        JSON.stringify(details)
    );
}

export function createAuditor(actor) {
    return (action, target, details = {}) => record(actor, action, target, details);
}
