import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, keypair, archive, submission, finalize } from './helpers.js';
import { sha256 } from '../src/storage.js';

async function release(f, key, slot) {
    assert.equal((await finalize(f, key, slot)).status, 200);
    const r = await f.admin('submissions/' + slot.details.id + '/approve', {
        reviewedHash: sha256(slot.bytes),
        notes: 'Inspected JavaScript and metadata locally'
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return r;
}

test('private upload, exact reviewed artifact, immutable publication, public discovery and revocation', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const slot = await submission(
        f,
        key,
        archive('magic/M15/Land', '0.1', 'template'),
        'magic/M15/Land',
        '0.1',
        'template'
    );
    assert.equal(slot.response.status, 201);
    assert.equal((await f.fetch('/v1/submissions/' + slot.details.id)).status, 401);
    assert.equal((await f.fetch('/v1/packages/' + slot.details.id)).status, 404);
    assert.equal(
        (
            await f.admin('submissions/' + slot.details.id + '/approve', {
                reviewedHash: sha256(slot.bytes)
            })
        ).status,
        409
    );
    let r = await f.fetch('/v1/submissions/' + slot.details.id + '/finalize', {
        method: 'POST',
        key,
        body: {}
    });
    assert.equal(r.status, 409);
    r = await f.fetch(slot.details.uploadPath, {
        method: 'PUT',
        key,
        body: archive('different')
    });
    assert.equal(r.status, 409);
    r = await f.fetch(slot.details.uploadPath, { method: 'PUT', key, body: slot.bytes });
    assert.equal(r.status, 200);
    r = await f.fetch(slot.details.uploadPath, { method: 'PUT', key, body: slot.bytes });
    assert.equal(r.status, 200);
    r = await f.fetch('/v1/submissions/' + slot.details.id + '/finalize', {
        method: 'POST',
        key,
        body: {}
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).verifiedHash, sha256(slot.bytes));
    assert.equal((await f.fetch('/v1/extensions')).status, 200);
    assert.deepEqual((await (await f.fetch('/v1/extensions')).json()).extensions, []);
    assert.equal(
        (
            await f.admin('submissions/' + slot.details.id + '/approve', {
                reviewedHash: '0'.repeat(64)
            })
        ).status,
        409
    );
    const downloaded = await f.admin('submissions/' + slot.details.id + '/artifact');
    assert.equal(
        sha256(new Uint8Array(await downloaded.arrayBuffer())),
        sha256(slot.bytes)
    );
    assert.equal(
        (
            await f.admin('submissions/' + slot.details.id + '/approve', {
                reviewedHash: sha256(slot.bytes)
            })
        ).status,
        200
    );
    assert.equal(
        (
            await f.admin('submissions/' + slot.details.id + '/approve', {
                reviewedHash: sha256(slot.bytes)
            })
        ).status,
        200
    );
    const id = encodeURIComponent('magic/M15/Land');
    r = await f.fetch('/v1/extensions/' + id);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, 'magic/M15/Land');
    r = await f.fetch('/v1/extensions/' + id + '/versions');
    assert.equal(r.status, 200);
    const { versions } = await r.json();
    assert.equal(versions[0].version, '0.1.0');
    assert.equal(versions[0].state, 'published');
    assert.equal(versions[0].sha256, sha256(slot.bytes));
    r = await f.app.fetch(new Request(versions[0].downloadUrl));
    assert.equal(r.status, 200);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), slot.bytes);
    assert.equal(
        (await f.fetch(slot.details.uploadPath, { method: 'PUT', key, body: slot.bytes }))
            .status,
        409
    );
    assert.equal(
        (await submission(f, key, slot.bytes, 'magic/M15/Land', '0.1', 'template'))
            .response.status,
        409
    );
    assert.throws(
        () => f.db.run('UPDATE extension_versions SET sha256=\'bad\''),
        /immutable/
    );
    await f.admin('versions/' + id + '/0.1.0', {
        state: 'deprecated',
        notes: 'Use a newer version'
    });
    assert.equal(
        (await (await f.fetch('/v1/extensions/' + id + '/versions/0.1.0')).json()).state,
        'deprecated'
    );
    await f.admin('versions/' + id + '/0.1.0', {
        state: 'revoked',
        notes: 'Unsafe extension'
    });
    assert.equal((await f.fetch('/v1/packages/' + slot.details.id)).status, 404);
    r = await f.fetch('/v1/extensions/' + id + '/versions/0.1.0');
    assert.equal((await r.json()).downloadUrl, null);
    assert.equal(
        (await f.admin('versions/' + id + '/0.1.0', { state: 'deprecated' })).status,
        409
    );
    assert.deepEqual((await (await f.fetch('/v1/extensions')).json()).extensions, []);
    assert.equal(f.errors.length, 0);
});

test('ownership reservations, submission privacy, duplicate slots, idempotency conflicts', async t => {
    const f = fixture(t);
    const a = await keypair();
    const b = await keypair();
    await f.approve(a);
    await f.approve(b);
    const slot = await submission(
        f,
        a,
        archive(),
        'demo',
        '1.0.0',
        'game',
        'safe-retry-123'
    );
    assert.equal(slot.response.status, 201);
    const retry = await submission(
        f,
        a,
        archive(),
        'demo',
        '1.0.0',
        'game',
        'safe-retry-123'
    );
    assert.equal(retry.details.id, slot.details.id);
    assert.equal(
        (
            await submission(
                f,
                a,
                archive('demo', '2.0.0'),
                'demo',
                '2.0.0',
                'game',
                'safe-retry-123'
            )
        ).response.status,
        409
    );
    assert.equal((await submission(f, a)).response.status, 409);
    assert.equal(
        (await submission(f, b, archive('demo', '2.0.0'), 'demo', '2.0.0')).response
            .status,
        409
    );
    assert.equal(
        (await f.fetch('/v1/submissions/' + slot.details.id, { key: b })).status,
        404
    );
    assert.equal(
        (
            await f.fetch(slot.details.uploadPath, {
                method: 'PUT',
                key: b,
                body: slot.bytes
            })
        ).status,
        404
    );
    await release(f, a, slot);
    assert.equal(
        (await submission(f, b, archive('demo', '2.0.0'), 'demo', '2.0.0')).response
            .status,
        403
    );
    assert.equal(f.errors.length, 0);
});

test('finalization derives metadata, detects manifest mismatch and staged tampering', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const mismatch = await submission(f, key, archive('actual'), 'claimed');
    assert.equal((await finalize(f, key, mismatch)).status, 409);
    const slot = await submission(f, key);
    assert.equal((await finalize(f, key, slot)).status, 200);
    const original = f.storage.get.bind(f.storage);
    f.storage.get = k =>
        k === 'staging/' + slot.details.id ? archive('corrupt') : original(k);
    assert.equal(
        (
            await f.admin('submissions/' + slot.details.id + '/approve', {
                reviewedHash: sha256(slot.bytes)
            })
        ).status,
        409
    );
    assert.equal(f.db.get('SELECT count(*) n FROM extension_versions').n, 0);
});

test('rejected and expired submissions stay private; withdrawal permits a new slot', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const slot = await submission(f, key);
    await finalize(f, key, slot);
    await f.admin('submissions/' + slot.details.id + '/reject', {
        notes: 'Please fix code'
    });
    assert.equal((await f.fetch('/v1/packages/' + slot.details.id)).status, 404);
    const replacement = await submission(f, key);
    assert.equal(replacement.response.status, 201);
    f.db.run('UPDATE submissions SET expires=0 WHERE id=?', replacement.details.id);
    assert.equal(
        (
            await f.fetch(replacement.details.uploadPath, {
                method: 'PUT',
                key,
                body: replacement.bytes
            })
        ).status,
        410
    );
    assert.equal(
        (
            await f.fetch('/v1/submissions/' + replacement.details.id + '/withdraw', {
                method: 'POST',
                key,
                body: {}
            })
        ).status,
        200
    );
    assert.equal((await submission(f, key)).response.status, 201);
});

test('public catalog filtering, pagination, semantic version ordering, ETags, unknown records', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    for (const [id, version, type] of [
        ['demo', '1.10.0', 'game'],
        ['demo', '1.2.0', 'game'],
        ['other', '0.1', 'exporter']
    ])
        await release(
            f,
            key,
            await submission(f, key, archive(id, version, type), id, version, type)
        );
    let r = await f.fetch('/v1/extensions?type=game&q=demo&limit=1');
    const etag = r.headers.get('etag');
    let data = await r.json();
    assert.equal(data.extensions.length, 1);
    assert.equal(data.extensions[0].id, 'demo');
    assert.equal(data.extensions[0].metadata.version, '1.10.0');
    r = await f.fetch('/v1/extensions?type=game&q=demo&limit=1', {
        headers: { 'if-none-match': etag }
    });
    assert.equal(r.status, 304);
    data = await (await f.fetch('/v1/extensions?limit=1')).json();
    assert.equal(data.nextOffset, 1);
    data = await (await f.fetch('/v1/extensions?limit=1&offset=1')).json();
    assert.equal(data.extensions[0].id, 'other');
    assert.equal(data.nextOffset, null);
    data = await (await f.fetch('/v1/extensions/demo/versions')).json();
    assert.deepEqual(
        data.versions.map(v => v.version),
        ['1.10.0', '1.2.0']
    );
    for (const path of ['/v1/extensions?limit=-1', '/v1/extensions?type=bad'])
        assert.equal((await f.fetch(path)).status, 400);
    for (const path of [
        '/v1/extensions/missing',
        '/v1/extensions/missing/versions',
        '/v1/extensions/demo/versions/9.0.0'
    ])
        assert.equal((await f.fetch(path)).status, 404);
});

test('promotion failure leaves no public record; deterministic retry recovers an orphaned object', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const slot = await submission(f, key);
    await finalize(f, key, slot);
    const get = f.storage.get.bind(f.storage);
    let fail = true;
    f.storage.get = k => (k === 'releases/' + slot.details.id && fail ? null : get(k));
    let r = await f.admin('submissions/' + slot.details.id + '/approve', {
        reviewedHash: sha256(slot.bytes)
    });
    assert.equal(r.status, 503);
    assert.equal(f.db.get('SELECT count(*) n FROM extension_versions').n, 0);
    assert.equal(
        f.db.get('SELECT state FROM submissions WHERE id=?', slot.details.id).state,
        'pending_review'
    );
    fail = false;
    r = await f.admin('submissions/' + slot.details.id + '/approve', {
        reviewedHash: sha256(slot.bytes)
    });
    assert.equal(r.status, 200);
    assert.equal((await f.fetch('/v1/packages/' + slot.details.id)).status, 200);
});
