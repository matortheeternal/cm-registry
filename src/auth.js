import * as accessRequests from './database/accessRequests.js';
import * as publisherKeys from './database/publisherKeys.js';
import * as usedNonces from './database/usedNonces.js';
import {
    createSignature,
    appendSignature,
    verifySignature,
    webcrypto
} from 'http-message-sig';
import { sha256 } from './storage.js';
import {
    BodyDigestMismatch,
    InvalidIdempotencyKey,
    InvalidPublicKey,
    InvalidRequestSignature,
    NonceAlreadyUsed,
    Problem,
    PublisherSuspended,
    PublishingAccessUnavailable,
    PublishingKeyRevoked
} from './errors.js';

export async function publicIdentity(publicKey) {
    if (typeof publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(publicKey))
        throw new InvalidPublicKey();
    const bytes = Buffer.from(publicKey, 'base64');
    const key = await crypto.subtle.importKey('raw', bytes, 'Ed25519', false, ['verify']);
    return { fingerprint: sha256(bytes), key, publicKey };
}

const components = [
    '@method',
    '@target-uri',
    'content-digest',
    'content-type',
    'idempotency-key'
];
export async function contentDigest(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `sha-256=:${Buffer.from(digest).toString('base64')}:`;
}

// Reference Node signer for protocol tests. Never stores private keys.
export async function signRequest(request, privateKey, fingerprint, options = {}) {
    const headers = new Headers(request.headers);
    headers.set(
        'content-digest',
        await contentDigest(await request.clone().arrayBuffer())
    );
    if (!headers.has('content-type'))
        headers.set('content-type', 'application/octet-stream');
    if (!headers.has('idempotency-key'))
        headers.set('idempotency-key', options.idempotencyKey ?? crypto.randomUUID());
    request = new Request(request, { headers });
    const created = options.created ?? Math.floor(Date.now() / 1000);
    const fields = await createSignature(request, {
        label: 'sig1',
        components,
        parameters: {
            created,
            expires: created + 300,
            nonce: options.nonce ?? crypto.randomUUID(),
            keyid: fingerprint,
            alg: 'ed25519'
        },
        signer: webcrypto.signer(privateKey)
    });
    return new Request(request, { headers: appendSignature(headers, fields) });
}

function lookupPublicKey(fingerprint, registrationKey) {
    if (registrationKey) return { public_key: registrationKey };
    return (
        publisherKeys.findPublicKey(fingerprint)
        ?? accessRequests.findPublicKey(fingerprint)
    );
}

function validSignatureParameters(signature) {
    const { created, expires, nonce } = signature.parameters;
    return (
        Number.isInteger(created)
        && Number.isInteger(expires)
        && expires > created
        && expires - created <= 300
        && typeof nonce === 'string'
        && /^[a-zA-Z0-9_-]{16,128}$/.test(nonce)
    );
}

export async function authenticate(request, body, registrationKey) {
    let identity;
    try {
        const verified = await verifySignature(request, {
            label: 'sig1',
            policy: {
                algorithms: ['ed25519'],
                requiredComponents: components,
                requiredParameters: ['created', 'expires', 'nonce', 'keyid', 'alg'],
                maxAge: 300,
                clockSkew: 5,
                validate: validSignatureParameters
            },
            resolveVerifier: async candidate => {
                const fingerprint = candidate.parameters.keyid;
                const record = lookupPublicKey(fingerprint, registrationKey);
                if (!record) throw new Error('Unknown key');
                identity = await publicIdentity(record.public_key);
                if (identity.fingerprint !== fingerprint) throw new Error('Wrong key');
                return webcrypto.verifier(identity.key);
            }
        });
        if (request.headers.get('content-digest') !== (await contentDigest(body)))
            throw new BodyDigestMismatch();
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(request.headers.get('idempotency-key') ?? ''))
            throw new InvalidIdempotencyKey();
        usedNonces.pruneExpired({ before: Math.floor(Date.now() / 1000) - 5 });
        const result = usedNonces.consume({
            keyId: identity.fingerprint,
            nonce: verified.parameters.nonce,
            expires: verified.parameters.expires
        });
        if (result.changes !== 1) throw new NonceAlreadyUsed();
        return identity.fingerprint;
    } catch (error) {
        if (error instanceof Problem) throw error;
        throw new InvalidRequestSignature();
    }
}

export function activePublisher(fingerprint) {
    const row = publisherKeys.findWithPublisherState(fingerprint);
    if (!row) {
        const application = accessRequests.findState(fingerprint);
        throw new PublishingAccessUnavailable(application?.state ?? 'unknown');
    }

    if (row.revoked) throw new PublishingKeyRevoked();
    if (row.publisher_state !== 'active') throw new PublisherSuspended();
    return row.publisher_id;
}
