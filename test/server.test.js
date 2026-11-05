import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RegistryClient, loadOrCreateKey } from '../src/client.js';
import { archive, token } from './helpers.js';
import { sha256 } from '../src/storage.js';

test('actual local HTTP server and reference client complete application, review, and package download', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-http-'));
    const child = spawn(process.execPath, ['src/server.js'], {
        env: {
            ...process.env,
            PORT: '0',
            REGISTRY_DATA: join(directory, 'data'),
            REGISTRY_ADMIN_TOKEN: token
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null) {
            const done = once(child, 'exit');
            child.kill('SIGTERM');
            await done;
        }
        rmSync(directory, { recursive: true, force: true });
    });
    const origin = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Server did not start'));
        }, 5000);
        child.once('error', e => {
            clearTimeout(timer);
            reject(e);
        });
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error('Server exited: ' + code));
        });
        child.stdout.on('data', chunk => {
            const match = chunk.toString().match(/Registry: (http:\/\/127\.0\.0\.1:\d+)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
    });
    const key = await loadOrCreateKey(join(directory, 'keys'));
    const client = new RegistryClient({ origin, key });
    const application = await client.requestAccess({
        displayName: 'HTTP author',
        description: 'Real HTTP protocol exercise'
    });
    assert.equal((await client.accessStatus(application.id)).state, 'pending');
    let response = await fetch(
        origin + '/v1/admin/access-requests/' + application.id + '/approve',
        {
            method: 'POST',
            headers: {
                authorization: 'Bearer ' + token,
                'content-type': 'application/json'
            },
            body: '{}'
        }
    );
    assert.equal(response.status, 200);
    const bytes = archive();
    const submission = await client.publish(bytes);
    assert.equal(submission.state, 'pending_review');
    assert.equal((await fetch(origin + '/v1/packages/' + submission.id)).status, 404);
    response = await fetch(
        origin + '/v1/admin/submissions/' + submission.id + '/approve',
        {
            method: 'POST',
            headers: {
                authorization: 'Bearer ' + token,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ reviewedHash: sha256(bytes) })
        }
    );
    assert.equal(response.status, 200);
    response = await fetch(origin + '/v1/packages/' + submission.id);
    assert.equal(response.status, 200);
    assert.equal(sha256(new Uint8Array(await response.arrayBuffer())), sha256(bytes));
});

test('Fly adapter verifies public signatures and isolates administration on its private port', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'registry-fly-'));
    const publicOrigin = 'https://registry.example.com';
    const child = spawn(process.execPath, ['src/server.js'], {
        env: {
            ...process.env,
            PORT: '0',
            REGISTRY_ADMIN_PORT: '0',
            REGISTRY_PUBLIC_ORIGIN: publicOrigin,
            REGISTRY_DATA: join(directory, 'data'),
            REGISTRY_ADMIN_TOKEN: token
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null) {
            const done = once(child, 'exit');
            child.kill('SIGTERM');
            await done;
        }
        rmSync(directory, { recursive: true, force: true });
    });
    const { origin, adminOrigin } = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Fly adapter did not start')), 5000);
        child.once('error', reject);
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error('Server exited: ' + code));
        });
        child.stdout.on('data', chunk => {
            output += chunk;
            const port = output.match(/Listening on port (\d+)/);
            const admin = output.match(/Private administration: (http:\/\/127\.0\.0\.1:\d+)/);
            if (port && admin) {
                clearTimeout(timer);
                resolve({ origin: `http://127.0.0.1:${port[1]}`, adminOrigin: admin[1] });
            }
        });
    });
    const key = await loadOrCreateKey(join(directory, 'keys'));
    const client = new RegistryClient({
        origin: publicOrigin,
        key,
        // Emulate Fly's HTTPS termination without changing the signed URL headers.
        fetch: request => fetch(origin + new URL(request.url).pathname, {
            method: request.method,
            headers: { ...Object.fromEntries(request.headers), 'x-forwarded-host': 'evil.example' },
            ...(!['GET', 'HEAD'].includes(request.method)
                ? { body: request.body, duplex: 'half' } : {})
        })
    });
    const application = await client.requestAccess({
        displayName: 'Fly author', description: 'Public HTTPS signature test'
    });
    assert.equal((await client.accessStatus(application.id)).state, 'pending');
    for (const path of ['/admin', '/admin/app.js', '/v1/admin/overview'])
        assert.equal((await fetch(origin + path, {
            headers: { authorization: 'Bearer ' + token, host: '127.0.0.1' }
        })).status, 404);
    assert.equal((await fetch(adminOrigin + '/v1/admin/overview')).status, 401);
    assert.equal((await fetch(adminOrigin + '/v1/admin/overview', {
        headers: { authorization: 'Bearer ' + token }
    })).status, 200);
    assert.equal((await fetch(adminOrigin + '/v1/admin/access-requests/' + application.id + '/approve', {
        method: 'POST',
        headers: {
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
            origin: adminOrigin
        },
        body: '{}'
    })).status, 200);
    const submission = await client.publish(archive());
    assert.equal(submission.state, 'pending_review');
});
