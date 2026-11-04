import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database, initializeDatabase } from '../src/db.js';
import { getDatabase, withDatabase } from '../src/database/connection.js';
import * as accessRequests from '../src/database/accessRequests.js';
import * as auditEvents from '../src/database/auditEvents.js';
import * as publishers from '../src/database/publishers.js';
import * as publisherKeys from '../src/database/publisherKeys.js';
import { fixture, keypair } from './helpers.js';

test('default database lifecycle and explicit transactions keep table operations on the correct connection', t => {
    assert.throws(() => publishers.listRecent(), /Initialize the database/);
    let current = initializeDatabase(':memory:');
    t.after(() => current?.close());
    const explicit = new Database();
    t.after(() => explicit.close());
    assert.equal(getDatabase(), current);
    assert.throws(() => initializeDatabase(':memory:'), /already initialized/);
    assert.equal(getDatabase(), current);

    publishers.create({
        id: 'default-owner',
        displayName: 'Default',
        email: null
    });
    assert.throws(
        () =>
            explicit.transaction(() => {
                publishers.create({
                    id: 'explicit-owner',
                    displayName: 'Explicit',
                    email: null
                });
                auditEvents.record('test', 'publisher.create', 'explicit-owner');
                throw new Error('Abort the multi-table transaction');
            }),
        /Abort the multi-table transaction/
    );
    assert.deepEqual(
        publishers.listRecent().map(row => row.id),
        ['default-owner']
    );
    assert.equal(withDatabase(explicit, () => publishers.listRecent()).length, 0);
    assert.equal(withDatabase(explicit, () => auditEvents.listRecent()).length, 0);

    explicit.transaction(() => {
        publishers.create({
            id: 'explicit-owner',
            displayName: 'Explicit',
            email: null
        });
        auditEvents.record('test', 'publisher.create', 'explicit-owner');
    });
    assert.equal(
        withDatabase(explicit, () => publishers.exists('explicit-owner')),
        true
    );
    assert.equal(publishers.exists('explicit-owner'), false);
    current.close();
    current = undefined;
    assert.throws(() => getDatabase(), /Initialize the database/);
    current = initializeDatabase(':memory:');
    assert.deepEqual(publishers.listRecent(), []);
});

test('concurrent app requests retain independent databases across signature verification awaits', async t => {
    const left = fixture(t);
    const right = fixture(t);
    const key = await keypair();
    const [leftRequest, rightRequest] = await Promise.all([
        left.register(key),
        right.register(key)
    ]);
    assert.notEqual(leftRequest.id, rightRequest.id);
    const decisions = await Promise.all([
        left.admin('access-requests/' + leftRequest.id + '/approve', {}),
        right.admin('access-requests/' + rightRequest.id + '/reject', {
            notes: 'Declined here only'
        })
    ]);
    assert.deepEqual(
        decisions.map(response => response.status),
        [200, 200]
    );
    const statuses = await Promise.all([
        left.fetch('/v1/access-requests/' + leftRequest.id, { key }),
        right.fetch('/v1/access-requests/' + rightRequest.id, { key })
    ]);
    assert.deepEqual(
        await Promise.all(statuses.map(async response => (await response.json()).state)),
        ['approved', 'rejected']
    );
    const access = await Promise.all([
        left.fetch('/v1/submissions', { key }),
        right.fetch('/v1/submissions', { key })
    ]);
    assert.deepEqual(
        access.map(response => response.status),
        [200, 403]
    );
    assert.equal(withDatabase(left.db, () => publishers.listRecent()).length, 1);
    assert.equal(withDatabase(right.db, () => publishers.listRecent()).length, 0);
    assert.throws(() => getDatabase(), /Initialize the database/);
});

test('failed access approval rolls back publisher creation across table modules', async t => {
    const registry = fixture(t);
    const key = await keypair();
    const application = await registry.register(key);
    withDatabase(registry.db, () => {
        publishers.create({
            id: 'existing-owner',
            displayName: 'Existing',
            email: null
        });
        publisherKeys.createInitial({
            fingerprint: key.fingerprint,
            publisherId: 'existing-owner',
            publicKey: key.rawPublicKey
        });
    });
    const response = await registry.admin(
        'access-requests/' + application.id + '/approve',
        {}
    );
    assert.equal(response.status, 409);
    withDatabase(registry.db, () => {
        assert.equal(publishers.listRecent().length, 1);
        assert.equal(accessRequests.findById(application.id).state, 'pending');
        assert.equal(
            auditEvents.listRecent().filter(row => row.action === 'access.approve')
                .length,
            0
        );
    });
});
