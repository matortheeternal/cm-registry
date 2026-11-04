import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { inspectPackage } from '../src/package.js';
import { activePublisher } from '../src/auth.js';
import { Submissions } from '../src/submissions.js';
import { withDatabase } from '../src/database/connection.js';
import { readBody, createErrorHandler } from '../src/http.js';
import { fixture, keypair } from './helpers.js';
import {
    Problem,
    InvalidArchiveSize,
    UnsupportedArchiveEntries,
    SubmissionNotFound,
    PublishingKeyRevoked,
    PublishingAccessUnavailable,
    RequestBodyTooLarge
} from '../src/errors.js';

test('archive guards throw concrete Problem subclasses and reject unsupported flag bits', () => {
    assert.throws(
        () => inspectPackage(new Uint8Array()),
        error => {
            assert.ok(error instanceof InvalidArchiveSize);
            assert.ok(error instanceof Problem);
            assert.equal(error.name, 'InvalidArchiveSize');
            assert.equal(error.status, 400);
            assert.equal(error.code, 'archive_size');
            return true;
        }
    );
    for (const flags of [1, 8, 0x40]) {
        const bytes = Buffer.from(
            zipSync({
                'games/demo/game.json': new TextEncoder().encode(
                    '{"id":"demo","version":"1.0.0"}'
                )
            })
        );
        const directory = bytes.readUInt32LE(bytes.length - 6);
        bytes.writeUInt16LE(flags, 6);
        bytes.writeUInt16LE(flags, directory + 8);
        assert.throws(() => inspectPackage(bytes), UnsupportedArchiveEntries);
    }
});

test('submission and publisher guards expose typed failures without changing HTTP error payloads', async t => {
    const registry = fixture(t);
    const key = await keypair();
    await registry.approve(key);
    const submissions = new Submissions({ storage: registry.storage });
    withDatabase(registry.db, () => {
        assert.throws(
            () => submissions.getOwned(key.fingerprint, 'missing'),
            SubmissionNotFound
        );
    });
    await registry.admin('keys/' + key.fingerprint + '/revoke', {});
    withDatabase(registry.db, () => {
        assert.throws(() => activePublisher(key.fingerprint), PublishingKeyRevoked);
    });
    const response = await registry.fetch('/v1/submissions', { key });
    assert.equal(response.status, 403);
    const result = await response.json();
    assert.deepEqual(result.error, {
        code: 'key_revoked',
        message: 'Publishing key has been revoked'
    });
    assert.ok(result.requestId);
});

test('body-limit failures retain their concrete type and reject invalid limits', async () => {
    const request = () =>
        new Request('https://localhost', {
            method: 'POST',
            headers: { 'content-length': '10' },
            body: '0123456789'
        });
    await assert.rejects(() => readBody(request(), 9), RequestBodyTooLarge);
    await assert.rejects(() => readBody(request(), NaN), RequestBodyTooLarge);
});

test('HTTP error handling recognizes a subclass with a dynamic access state', () => {
    const error = new PublishingAccessUnavailable('pending');
    const response = createErrorHandler(() =>
        assert.fail('Known errors should not be logged')
    )(error, {
        get: () => 'request-id',
        json: (body, status) => ({ body, status })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
        error: { code: 'access_pending', message: 'Publishing access is pending' },
        requestId: 'request-id'
    });
});
