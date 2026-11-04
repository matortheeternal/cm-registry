import * as rateLimits from './database/rateLimits.js';
import { ZodError } from 'zod';
import {
    InvalidJSONBody,
    JSONContentTypeRequired,
    Problem,
    RateLimitExceeded,
    RequestBodyTooLarge
} from './errors.js';

export async function readBody(request, limit) {
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !(Number(length) <= limit)))
        throw new RequestBodyTooLarge();
    if (!request.body) return new Uint8Array();
    const { chunks, size } = await readChunks(request.body, limit);
    return combineChunks(chunks, size);
}

async function readChunks(stream, limit) {
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) return { chunks, size };
            size += value.length;
            if (size > limit) {
                await reader.cancel();
                throw new RequestBodyTooLarge();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
}

function combineChunks(chunks, size) {
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
    }
    return body;
}

export function jsonBody(context, schema) {
    if (context.req.header('content-type')?.split(';')[0] !== 'application/json')
        throw new JSONContentTypeRequired();
    try {
        return schema.parse(JSON.parse(new TextDecoder().decode(context.get('body'))));
    } catch (e) {
        if (e instanceof ZodError) throw e;
        throw new InvalidJSONBody();
    }
}

export function rate(scope, max) {
    const window = Math.floor(Date.now() / 60000);
    const row = rateLimits.increment({ scope, window });
    if (!(row.count <= max)) throw new RateLimitExceeded();
}

function isConflict(error) {
    return error.code?.startsWith('SQLITE_CONSTRAINT')
        || error.errcode === 2067
        || error.errcode === 1555
        || /UNIQUE constraint failed/.test(error.message);
}

function errorDetails(error) {
    if (error instanceof ZodError)
        return {
            status: 400,
            body: {
                code: 'validation',
                message: 'Invalid request fields',
                fields: error.issues.map(issue => issue.path.join('.'))
            }
        };
    if (error instanceof Problem)
        return { status: error.status, body: { code: error.code, message: error.message } };
    if (isConflict(error))
        return {
            status: 409,
            body: { code: 'conflict', message: 'Record already exists or version is reserved' }
        };
    return {
        status: 500, unexpected: true,
        body: { code: 'internal', message: 'Internal registry error' }
    };
}

export function createErrorHandler(onError) {
    return (error, context) => {
        const details = errorDetails(error);
        const requestId = context.get('requestId');
        if (details.unexpected) onError({ requestId, code: error.code ?? 'internal' });
        return context.json({ error: details.body, requestId }, details.status);
    };
}
