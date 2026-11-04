import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDatabase } from '../src/database/connection.js';
import * as accessRequests from '../src/database/accessRequests.js';
import * as publishers from '../src/database/publishers.js';
import * as publisherKeys from '../src/database/publisherKeys.js';
import * as submissions from '../src/database/submissions.js';
import * as auditEvents from '../src/database/auditEvents.js';
import { fixture } from './helpers.js';

const timestampTables = [
    'access_requests', 'publishers', 'publisher_keys', 'submissions', 'audit_events'
];

test('all creation inserts use SQLite CURRENT_TIMESTAMP instead of the JavaScript clock', t => {
    const registry = fixture(t);
    t.mock.method(Date, 'now', () => 1);
    const before = registry.db.get('SELECT CURRENT_TIMESTAMP value').value;
    withDatabase(registry.db, () => {
        publishers.create({ id: 'owner', displayName: 'Owner', email: null });
        publisherKeys.createInitial({
            fingerprint: 'initial-key', publisherId: 'owner', publicKey: 'public-key'
        });
        publisherKeys.create({
            fingerprint: 'rotated-key', publisherId: 'owner',
            publicKey: 'other-key', label: 'Rotation'
        });
        accessRequests.create({
            id: 'request', fingerprint: 'request-key', publicKey: 'public-key',
            displayName: 'Applicant', email: null, description: 'Games'
        });
        submissions.create({
            id: 'slot', publisherId: 'owner', extensionId: 'demo', version: '1.0.0',
            type: 'game', expectedHash: 'a'.repeat(64), size: 1,
            idempotencyKey: 'retry', requestHash: 'hash', expires: 12345
        });
        auditEvents.record('owner', 'submission.create', 'slot');
    });
    const after = registry.db.get('SELECT CURRENT_TIMESTAMP value').value;
    for (const table of timestampTables) {
        const column = registry.db.all(`PRAGMA table_info(${table})`)
            .find(row => row.name === 'created');
        assert.equal(column.type, 'TEXT');
        assert.equal(column.dflt_value, 'CURRENT_TIMESTAMP');
        const rows = registry.db.all(`SELECT created,typeof(created) type FROM ${table}`);
        for (const row of rows) {
            assert.equal(row.type, 'text');
            assert.match(row.created, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            assert.ok(row.created >= before && row.created <= after);
        }
    }
    assert.equal(registry.db.get('SELECT expires FROM submissions').expires, 12345);
});

test('recent records use insertion order when default timestamps have the same second', t => {
    const registry = fixture(t);
    registry.db.run(`INSERT INTO publishers(id,display_name)
        VALUES('older','Older'),('newer','Newer')`);
    const records = withDatabase(registry.db, () => publishers.listRecent());
    assert.equal(records[0].created, records[1].created);
    assert.deepEqual(records.map(row => row.id), ['newer', 'older']);
});
