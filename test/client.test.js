import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    statSync,
    readFileSync,
    symlinkSync,
    mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateKey, RegistryClient } from '../src/client.js';
import { fixture, archive } from './helpers.js';

test('reference client generates and reuses protected keys, applies and polls, submits exact package with safe retry', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-key-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const key = await loadOrCreateKey(join(directory, 'keys'));
    const again = await loadOrCreateKey(join(directory, 'keys'));
    assert.equal(key.fingerprint, again.fingerprint);
    assert.equal(statSync(join(directory, 'keys')).mode & 0o777, 0o700);
    assert.equal(statSync(key.path).mode & 0o777, 0o600);
    assert.ok(JSON.parse(readFileSync(key.path)).privateKey);
    const f = fixture(t);
    const client = new RegistryClient({
        origin: 'https://localhost',
        key,
        fetch: req => f.app.fetch(req)
    });
    const access = await client.requestAccess({
        displayName: 'Local author',
        description: 'Game extensions'
    });
    assert.equal((await client.accessStatus(access.id)).state, 'pending');
    await assert.rejects(
        () => client.publish(archive()),
        e => e.code === 'access_pending'
    );
    await f.admin('access-requests/' + access.id + '/approve', {});
    const submission = await client.publish(archive());
    assert.equal(submission.state, 'pending_review');
    const retried = await client.publish(archive());
    assert.equal(retried.id, submission.id);
    assert.equal(f.db.get('SELECT count(*) n FROM submissions').n, 1);
});

test('reference client refuses non-loopback HTTP and symlink key files', async t => {
    assert.throws(
        () => new RegistryClient({ origin: 'http://example.org', key: {} }),
        /HTTPS/
    );
    const directory = mkdtempSync(join(tmpdir(), 'registry-key-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const original = await loadOrCreateKey(join(directory, 'a'));
    mkdirSync(join(directory, 'b'));
    symlinkSync(original.path, join(directory, 'b', 'publishing-key.json'));
    await assert.rejects(
        () => loadOrCreateKey(join(directory, 'b')),
        e => e.code === 'key_file'
    );
});
