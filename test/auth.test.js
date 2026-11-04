import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, keypair, origin } from './helpers.js';
import { signRequest } from '../src/auth.js';

test('Node WebCrypto RFC 9421 proof, pending status, approval, and key state', async t => {
    const f = fixture(t);
    const key = await keypair();
    const request = await f.register(key);
    assert.equal(request.state, 'pending');
    let r = await f.fetch('/v1/access-requests/' + request.id, { key });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).state, 'pending');
    r = await f.fetch('/v1/submissions', { key });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'access_pending');
    r = await f.admin('access-requests/' + request.id + '/approve', {});
    assert.equal(r.status, 200);
    const { publisherId } = await r.json();
    r = await f.fetch('/v1/submissions', { key });
    assert.equal(r.status, 200);
    await f.admin('publishers/' + publisherId, { state: 'suspended' });
    r = await f.fetch('/v1/submissions', { key });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'publisher_suspended');
    await f.admin('publishers/' + publisherId, { state: 'active' });
    await f.admin('keys/' + key.fingerprint + '/revoke', {});
    r = await f.fetch('/v1/submissions', { key });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'key_revoked');
});

test('tampered bodies, targets, queries, methods, expired and future times, malformed and unknown signatures fail', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const make = () =>
        new Request(origin + '/v1/submissions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        });
    const signed = await signRequest(make(), key.privateKey, key.fingerprint);
    const cases = [
        new Request(signed, { body: '{"changed":true}' }),
        new Request(origin + '/v1/submissions?changed=1', signed.clone()),
        new Request(origin + '/v1/keys', signed.clone()),
        new Request(origin + '/v1/submissions', {
            method: 'GET',
            headers: signed.headers
        }),
        await signRequest(make(), key.privateKey, key.fingerprint, {
            created: Math.floor(Date.now() / 1000) - 400
        }),
        await signRequest(make(), key.privateKey, key.fingerprint, {
            created: Math.floor(Date.now() / 1000) + 100
        }),
        new Request(make(), {
            headers: { signature: 'garbage', 'signature-input': 'garbage' }
        }),
        await signRequest(make(), key.privateKey, 'unknown-key')
    ];
    for (const request of cases) {
        const r = await f.app.fetch(request);
        assert.equal(r.status, 401, await r.text());
    }
    assert.equal(f.db.get('SELECT count(*) count FROM used_nonces').count, 1); // only initial application
});

test('replayed nonces rejected atomically including concurrent requests', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const signed = await signRequest(
        new Request(origin + '/v1/submissions'),
        key.privateKey,
        key.fingerprint
    );
    const responses = await Promise.all([
        f.app.fetch(signed.clone()),
        f.app.fetch(signed.clone())
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
});

test('approval/rejection idempotency and status isolation', async t => {
    const f = fixture(t);
    const a = await keypair();
    const b = await keypair();
    const request = await f.register(a);
    assert.equal((await f.register(a)).id, request.id);
    await f.register(b);
    assert.equal(
        (await f.fetch('/v1/access-requests/' + request.id, { key: b })).status,
        404
    );
    assert.equal(
        (await f.admin('access-requests/' + request.id + '/reject', { notes: 'Not yet' }))
            .status,
        200
    );
    assert.equal(
        (await f.admin('access-requests/' + request.id + '/approve', {})).status,
        409
    );
    const r = await f.fetch('/v1/submissions', { key: a });
    assert.equal((await r.json()).error.code, 'access_rejected');
});

test('new keys need possession proof; revocation and manual recovery', async t => {
    const f = fixture(t);
    const a = await keypair();
    const b = await keypair();
    const recoveryKey = await keypair();
    const { publisherId } = await f.approve(a);
    let r = await f.fetch('/v1/keys', {
        method: 'POST',
        key: a,
        body: { publicKey: b.rawPublicKey, proof: 'bad' }
    });
    assert.equal(r.status, 401);
    const proof = Buffer.from(
        await crypto.subtle.sign(
            'Ed25519',
            b.privateKey,
            new TextEncoder().encode(
                `cm-registry:add-key:${publisherId}:${b.fingerprint}`
            )
        )
    ).toString('base64');
    r = await f.fetch('/v1/keys', {
        method: 'POST',
        key: a,
        body: { publicKey: b.rawPublicKey, proof }
    });
    assert.equal(r.status, 201);
    assert.equal((await f.fetch('/v1/submissions', { key: b })).status, 200);
    assert.equal(
        (
            await f.fetch('/v1/keys/' + a.fingerprint + '/revoke', {
                method: 'POST',
                key: b,
                body: {}
            })
        ).status,
        200
    );
    assert.equal((await f.fetch('/v1/submissions', { key: a })).status, 403);
    assert.equal(
        (
            await f.admin('publishers/' + publisherId + '/keys', {
                publicKey: recoveryKey.rawPublicKey,
                notes: 'Verified identity by administrator offline'
            })
        ).status,
        201
    );
    assert.equal((await f.fetch('/v1/submissions', { key: recoveryKey })).status, 200);
});

test('initial application must prove possession of the exact submitted public key', async t => {
    const f = fixture(t);
    const a = await keypair();
    const b = await keypair();
    const r = await f.fetch('/v1/access-requests', {
        method: 'POST',
        key: a,
        body: {
            publicKey: b.rawPublicKey,
            displayName: 'False proof',
            description: 'Must fail'
        }
    });
    assert.equal(r.status, 401);
    assert.equal(f.db.get('SELECT count(*) n FROM access_requests').n, 0);
});

test('approval and rejection return stable states and are safe to repeat', async t => {
    const registry = fixture(t);
    const approvedKey = await keypair();
    const rejectedKey = await keypair();
    const approvedRequest = await registry.register(approvedKey);
    const rejectedRequest = await registry.register(rejectedKey);
    let approvedPublisher;
    for (let attempt = 0; attempt < 2; attempt++) {
        const approval = await registry.admin(
            `access-requests/${approvedRequest.id}/approve`, {}
        );
        assert.equal(approval.status, 200, await approval.clone().text());
        const approved = await approval.json();
        assert.equal(approved.state, 'approved');
        assert.ok(approved.publisherId);
        if (attempt === 0) approvedPublisher = approved.publisherId;
        assert.equal(approved.publisherId, approvedPublisher);

        const rejection = await registry.admin(
            `access-requests/${rejectedRequest.id}/reject`, { notes: 'Not approved' }
        );
        assert.equal(rejection.status, 200, await rejection.clone().text());
        assert.deepEqual(await rejection.json(), {
            id: rejectedRequest.id, state: 'rejected', publisherId: null
        });
    }
    assert.deepEqual(await registry.register(rejectedKey), {
        id: rejectedRequest.id, state: 'rejected', notes: 'Not approved'
    });
    assert.deepEqual(await registry.register(approvedKey), {
        id: approvedRequest.id, state: 'approved', notes: ''
    });
    const overview = await (await registry.admin('overview')).json();
    assert.equal(overview.publishers.length, 1);
    assert.equal(overview.keys.length, 1);
    assert.equal(overview.audit.filter(event => event.action === 'access.approve').length, 1);
    assert.equal(overview.audit.filter(event => event.action === 'access.reject').length, 1);
    assert.deepEqual(registry.errors, []);
});
