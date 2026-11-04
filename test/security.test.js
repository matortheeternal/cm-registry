import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, keypair, origin, submission } from './helpers.js';
import { signRequest } from '../src/auth.js';

test('admin auth boundary, CSRF, size limits, HTTPS, private errors and audit events', async t => {
    const f = fixture(t);
    assert.equal((await f.fetch('/v1/admin/overview')).status, 401);
    assert.equal(
        (
            await f.fetch('/v1/admin/overview', {
                headers: { authorization: 'Bearer bad' }
            })
        ).status,
        401
    );
    const cross = await f.fetch('/v1/admin/access-requests/no/approve', {
        method: 'POST',
        body: {},
        headers: { origin: 'https://evil.example' }
    });
    assert.equal(cross.status, 403);
    const http = await f.app.fetch(new Request('http://example.com/v1/extensions'));
    assert.equal(http.status, 400);
    const adminRemote = await f.app.fetch(
        new Request('https://example.com/v1/admin/overview')
    );
    assert.equal(adminRemote.status, 403);
    assert.equal(
        (
            await f.fetch('/v1/access-requests', {
                method: 'POST',
                body: { huge: 'x'.repeat(66000) }
            })
        ).status,
        413
    );
    assert.equal(
        (await f.fetch('/v1/access-requests', { method: 'POST', body: {} })).status,
        400
    );
    const key = await keypair();
    await f.approve(key);
    const slot = await submission(f, key);
    const overview = await (await f.admin('overview')).json();
    assert.ok(overview.audit.some(a => a.action === 'access.approve'));
    assert.ok(overview.audit.some(a => a.target === slot.details.id));
    const r = await f.fetch('/unknown');
    assert.equal(r.status, 404);
    assert.ok(r.headers.get('x-request-id'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await f.fetch('/admin')).status, 200);
    assert.match(
        (await f.fetch('/admin')).headers.get('content-security-policy'),
        /frame-ancestors 'none'/
    );
});

test('signature profile rejects missing signed components and parameters, unsupported algorithm, unsigned digest', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    const request = await signRequest(
        new Request(origin + '/v1/submissions'),
        key.privateKey,
        key.fingerprint
    );
    for (const transform of [
        s => s.replace('"content-digest" ', ''),
        s => s.replace(/;nonce="[^"]+"/, ''),
        s => s.replace('ed25519', 'rsa-pss-sha512')
    ]) {
        const headers = new Headers(request.headers);
        headers.set('signature-input', transform(headers.get('signature-input')));
        assert.equal((await f.app.fetch(new Request(request, { headers }))).status, 401);
    }
    const headers = new Headers(request.headers);
    headers.set('content-digest', 'sha-256=:invalid:');
    assert.equal((await f.app.fetch(new Request(request, { headers }))).status, 401);
});

test('public application rate limit and publisher outstanding quota', async t => {
    const f = fixture(t);
    const key = await keypair();
    await f.approve(key);
    for (let i = 0; i < 20; i++) {
        const r = await submission(f, key, undefined, 'extension-' + i);
        assert.equal(r.response.status, 201);
    }
    assert.equal((await submission(f, key, undefined, 'overflow')).response.status, 429);
    for (let i = 0; i < 20; i++)
        await f.fetch('/v1/access-requests', { method: 'POST', body: {} });
    assert.equal(
        (await f.fetch('/v1/access-requests', { method: 'POST', body: {} })).status,
        429
    );
});
