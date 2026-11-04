import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sha256 } from '../src/storage.js';
import { packageLimits } from '../src/packages/limits.js';
import { slotSchema } from '../src/schemas.js';
import { keypair } from './helpers.js';
import { startServer } from './adversarial/server.js';
import {
    hostileArchives,
    packageWith,
    entryCount,
    paddedManifest,
    sizeLimit,
    manifestLimit
} from './adversarial/archives.js';

async function submit(server, key, bytes) {
    const slot = await server.request('/v1/submissions', {
        method: 'POST',
        key,
        body: {
            extensionId: 'demo',
            type: 'game',
            version: '1.0.0',
            size: bytes.length,
            sha256: sha256(bytes)
        }
    });
    assert.equal(slot.status, 201, slot.text);
    const upload = await server.request(slot.data.uploadPath, {
        method: 'PUT',
        key,
        body: bytes
    });
    assert.equal(upload.status, 200, upload.text);
    return slot.data.id;
}

async function healthy(server) {
    const response = await server.request('/v1/extensions');
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.data.extensions, []);
    assert.equal(server.child.exitCode, null, 'The same server must remain running');
    assert.equal(server.child.signalCode, null);
    assert.equal(server.failure(), undefined);
}

test(
    'signed malicious archives are rejected and the same HTTP server continues serving',
    { timeout: 35000 },
    async t => {
        const server = await startServer(t);
        const key = await keypair();
        const application = await server.request('/v1/access-requests', {
            method: 'POST',
            key,
            body: {
                publicKey: key.rawPublicKey,
                displayName: 'Adversarial tests',
                description: 'Bounded hostile archives'
            }
        });
        assert.equal(application.status, 201);
        const approval = await server.request(
            `/v1/admin/access-requests/${application.data.id}/approve`,
            {
                method: 'POST',
                body: {},
                admin: true
            }
        );
        assert.equal(approval.status, 200);

        for (const fixture of hostileArchives()) {
            await t.test(fixture.name, async () => {
                // Each uploaded fixture is <=2 MiB; decoded test payloads are <=4 MiB.
                assert.ok(fixture.bytes.length <= 2 * 1024 * 1024);
                const id = await submit(server, key, fixture.bytes);
                try {
                    const result = await server.request(
                        `/v1/submissions/${id}/finalize`,
                        {
                            method: 'POST',
                            key,
                            body: {}
                        }
                    );
                    assert.equal(result.status, 400, result.text);
                    assert.equal(
                        (await server.request(`/v1/packages/${id}`)).status,
                        404
                    );
                } finally {
                    await healthy(server);
                    assert.equal(
                        (
                            await server.request(`/v1/submissions/${id}/withdraw`, {
                                method: 'POST',
                                key,
                                body: {}
                            })
                        ).status,
                        200
                    );
                }
            });
        }

        for (const [name, bytes] of [
            ['exactly 10,000 files', entryCount(10000)],
            ['exactly 1 MiB manifest', paddedManifest(manifestLimit)],
            [
                'nested ZIP stays opaque',
                packageWith({ 'games/demo/nested.zip': packageWith() })
            ],
            ['normal package after all attacks', packageWith()]
        ]) {
            await t.test(name, async () => {
                const id = await submit(server, key, bytes);
                const result = await server.request(`/v1/submissions/${id}/finalize`, {
                    method: 'POST',
                    key,
                    body: {}
                });
                assert.equal(result.status, 200, result.text);
                assert.equal(result.data.state, 'pending_review');
                await healthy(server);
                assert.equal(
                    (
                        await server.request(`/v1/submissions/${id}/withdraw`, {
                            method: 'POST',
                            key,
                            body: {}
                        })
                    ).status,
                    200
                );
            });
        }
        t.diagnostic(
            `Peak sampled server RSS: ${(server.peakRSS() / 1024).toFixed(1)} MiB`
        );
    }
);

test('300 MiB submission and HTTP size boundaries without allocating a 300 MiB body', async t => {
    assert.equal(packageLimits.archive, sizeLimit);
    assert.equal(packageLimits.expanded, sizeLimit);
    assert.equal(packageLimits.file, sizeLimit);
    assert.equal(packageLimits.manifest, manifestLimit);
    assert.equal(packageLimits.entries, 10000);
    const slot = {
        extensionId: 'demo',
        type: 'game',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        size: sizeLimit
    };
    assert.equal(slotSchema.safeParse(slot).success, true);
    assert.equal(slotSchema.safeParse({ ...slot, size: sizeLimit + 1 }).success, false);

    const server = await startServer(t);
    const status = await new Promise((resolve, reject) => {
        const request = http.request(
            server.origin + '/v1/submissions/unknown/artifact',
            {
                method: 'PUT',
                headers: { 'content-length': String(sizeLimit + 1) },
                timeout: 3000
            },
            response => {
                response.resume();
                resolve(response.statusCode);
            }
        );
        request.once('error', reject);
        request.once('timeout', () =>
            request.destroy(new Error('Oversize rejection timed out'))
        );
        request.end('Only this tiny body is actually sent.');
    });
    assert.equal(status, 413);
    await healthy(server);
});
