import { timingSafeEqual, randomUUID } from 'node:crypto';
import { authenticate, activePublisher } from './auth.js';
import { MAX_PACKAGE } from './package.js';
import {
    AdminCredentialRequired,
    CrossOriginWriteForbidden,
    HTTPSRequired,
    RemoteAdminUnconfigured
} from './errors.js';
import { readBody, rate } from './http.js';

export function createRequestMiddleware({ allowLocalHTTP }) {
    return async (context, next) => {
        context.set('requestId', randomUUID());
        context.header('X-Request-ID', context.get('requestId'));
        context.header('X-Content-Type-Options', 'nosniff');
        context.header('Cache-Control', 'no-store');
        context.header('Referrer-Policy', 'no-referrer');
        const url = new URL(context.req.url);
        validateProtocol(url, allowLocalHTTP);
        context.set('body', new Uint8Array());
        if (!['GET', 'HEAD'].includes(context.req.method))
            await readWriteBody(context, url);
        await next();
    };
}

function validateProtocol(url, allowLocalHTTP) {
    if (url.protocol === 'https:') return;
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!allowLocalHTTP || url.protocol !== 'http:' || !isLoopback)
        throw new HTTPSRequired();
}

async function readWriteBody(context, url) {
    rate('writes:global', 1000);
    // No cross-origin browser writes or permissive CORS, including admin bearer requests.
    const origin = context.req.header('origin');
    if (origin && origin !== url.origin) throw new CrossOriginWriteForbidden();
    const isUpload = /^\/v1\/submissions\/[^/]+\/artifact$/.test(url.pathname);
    context.set('body', await readBody(context.req.raw, isUpload ? MAX_PACKAGE : 65536));
}

export function createSignedMiddleware() {
    return async (context, next) => {
        context.set(
            'fingerprint',
            await authenticate(context.req.raw, context.get('body'))
        );
        await next();
    };
}

export function createPublisherMiddleware() {
    return async (context, next) => {
        context.set('publisherId', activePublisher(context.get('fingerprint')));
        rate(`publisher:${context.get('publisherId')}`, 120);
        await next();
    };
}

export function createAdminMiddleware({ adminToken, allowLocalHTTP }) {
    return async (context, next) => {
        // This adapter is deliberately local-only. Production Access verification is deferred.
        const url = new URL(context.req.url);
        if (
            !allowLocalHTTP
            || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
            throw new RemoteAdminUnconfigured();
        const supplied = Buffer.from(
            context.req.header('authorization')?.replace(/^Bearer /, '') ?? ''
        );
        const expected = Buffer.from(adminToken);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new AdminCredentialRequired();
        await next();
    };
}
