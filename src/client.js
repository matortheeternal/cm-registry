// Local reference client for protocol tests and registry development.
import { signRequest } from './auth.js';
import { inspectPackage } from './package.js';
import { sha256 } from './storage.js';
import {
    InvalidRegistryOrigin,
    InvalidRegistryResponse,
    RegistryHTTPSRequired,
    RegistryRequestFailed,
    SubmissionRetryUnavailable
} from './errors.js';

export { loadOrCreateKey } from './publisherKeys.js';

function registryOrigin(origin) {
    const url = new URL(origin);
    validateProtocol(url);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
        throw new InvalidRegistryOrigin();
    return url.origin;
}

function validateProtocol(url) {
    if (url.protocol === 'https:') return;
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'http:' || !isLoopback) throw new RegistryHTTPSRequired();
}

export class RegistryClient {
    constructor({ origin, key, fetch: fetcher = fetch }) {
        this.origin = registryOrigin(origin);
        this.key = key;
        this.fetch = fetcher;
    }

    async request(path, { method = 'GET', body, idempotencyKey } = {}) {
        const options = { method, headers: {} };
        if (body !== undefined) {
            const isBinary = body instanceof Uint8Array;
            options.headers['content-type'] = isBinary
                ? 'application/octet-stream'
                : 'application/json';
            options.body = isBinary ? body : JSON.stringify(body);
        }
        let request = new Request(this.origin + path, options);
        request = await signRequest(request, this.key.privateKey, this.key.fingerprint, {
            idempotencyKey
        });
        const response = await this.fetch(request);
        let result;
        try {
            result = await response.json();
        } catch {
            throw new InvalidRegistryResponse(response.status);
        }
        if (!response.ok) throw new RegistryRequestFailed(response.status, result.error);
        return result;
    }

    requestAccess(details) {
        return this.request('/v1/access-requests', {
            method: 'POST',
            body: { ...details, publicKey: this.key.publicKey }
        });
    }

    accessStatus(id) {
        return this.request('/v1/access-requests/' + encodeURIComponent(id));
    }

    async publish(bytes) {
        const info = inspectPackage(bytes);
        const digest = sha256(bytes);
        // Deterministic per-key/content retry identity. Every HTTP retry still gets a fresh nonce.
        const slot = await this.request('/v1/submissions', {
            method: 'POST',
            idempotencyKey: `publish-${digest}`,
            body: {
                extensionId: info.id,
                type: info.type,
                version: info.version,
                sha256: digest,
                size: bytes.length
            }
        });
        if (['approved', 'pending_review'].includes(slot.state)) return slot;
        if (slot.state !== 'awaiting_upload')
            throw new SubmissionRetryUnavailable(slot.state);
        await this.request(slot.uploadPath, { method: 'PUT', body: bytes });
        return this.request('/v1/submissions/' + slot.id + '/finalize', {
            method: 'POST',
            body: {}
        });
    }
}
