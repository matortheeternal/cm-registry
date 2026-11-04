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
