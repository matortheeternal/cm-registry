import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Database } from '../src/db.js';
import { FileStorage } from '../src/storage.js';
import { createApp } from '../src/app.js';
import { signRequest } from '../src/auth.js';
import { keypair, origin, token } from './helpers.js';

test('replay prevention persists across separate database connections and app instances', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-db-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const db1 = new Database(join(directory, 'registry.sqlite'));
    const db2 = new Database(join(directory, 'registry.sqlite'));
    t.after(() => {
        db1.close();
        db2.close();
    });
    const key = await keypair();
    db1.run(
        'INSERT INTO publishers(id,display_name) VALUES(?,?)',
        'owner',
        'Owner'
    );
    db1.run(
        `INSERT INTO publisher_keys (fingerprint, publisher_id, public_key)
            VALUES (?, ?, ?)`,
        key.fingerprint,
        'owner',
        key.rawPublicKey
    );
    const options = {
        storage: new FileStorage(join(directory, 'artifacts')),
        adminToken: token
    };
    const a = createApp({ ...options, db: db1 });
    const b = createApp({ ...options, db: db2 });
    const request = await signRequest(
        new Request(origin + '/v1/submissions'),
        key.privateKey,
        key.fingerprint
    );
    const responses = await Promise.all([
        a.fetch(request.clone()),
        b.fetch(request.clone())
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
});

test('file store immutable writes; database transaction rollback and migration rerun', t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-db-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const storage = new FileStorage(directory);
    storage.put('staging/test-id', Buffer.from('one'));
    storage.put('staging/test-id', Buffer.from('one'));
    assert.throws(
        () => storage.put('staging/test-id', Buffer.from('two')),
        e => e.code === 'immutable_artifact'
    );
    assert.equal(storage.get('staging/test-id').toString(), 'one');
    assert.throws(() => storage.get('../unsafe'));
    const db = new Database(join(directory, 'registry.sqlite'));
    assert.throws(() =>
        db.transaction(() => {
            db.audit('test', 'test', 'test');
            throw new Error('Rollback');
        })
    );
    assert.equal(db.all('SELECT * FROM audit_events').length, 0);
    db.close();
    const again = new Database(join(directory, 'registry.sqlite'));
    assert.equal(again.all('SELECT * FROM audit_events').length, 0);
    again.close();
});

test('maintenance migrates and backs up persisted data; cleanup retains pending review and release objects', t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-maint-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const env = { ...process.env, REGISTRY_DATA: directory };
    execFileSync(process.execPath, ['scripts/maintenance.js', 'migrate'], {
        env,
        stdio: 'pipe'
    });
    let db = new Database(join(directory, 'registry.sqlite'));
    db.run(
        'INSERT INTO publishers(id,display_name) VALUES(?,?)',
        'owner',
        'Owner'
    );
    for (const [id, state] of [
        ['expired', 'awaiting_upload'],
        ['review', 'pending_review'],
        ['released', 'approved'],
        ['rejected', 'rejected']
    ]) {
        db.run(
            `INSERT INTO submissions (id, publisher_id, extension_id, version,
                type, expected_hash, size, state, idempotency_key, request_hash,
                expires)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            'owner',
            id,
            '1.0.0',
            'game',
            'a'.repeat(64),
            1,
            state,
            id,
            'hash',
            0
        );
    }
    const storage = new FileStorage(join(directory, 'artifacts'));
    for (const id of ['expired', 'review', 'released', 'rejected'])
        storage.put('staging/' + id, Buffer.from('x'));
    storage.put('releases/released', Buffer.from('x'));
    db.close();
    execFileSync(
        process.execPath,
        ['scripts/maintenance.js', 'backup', join(directory, 'backup.sqlite')],
        { env, stdio: 'pipe' }
    );
    assert.ok(existsSync(join(directory, 'backup.sqlite')));
    const backup = new Database(join(directory, 'backup.sqlite'));
    assert.equal(backup.get('SELECT count(*) n FROM submissions').n, 4);
    backup.close();
    execFileSync(process.execPath, ['scripts/maintenance.js', 'cleanup'], {
        env,
        stdio: 'pipe'
    });
    db = new Database(join(directory, 'registry.sqlite'));
    assert.equal(
        db.get('SELECT state FROM submissions WHERE id=\'expired\'').state,
        'withdrawn'
    );
    db.close();
    assert.equal(storage.get('staging/expired'), null);
    assert.equal(storage.get('staging/rejected'), null);
    assert.ok(storage.get('staging/review'));
    assert.ok(storage.get('staging/released'));
    assert.ok(storage.get('releases/released'));
});
