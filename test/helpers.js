import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { Database } from '../src/db.js';
import { FileStorage, sha256 } from '../src/storage.js';
import { createApp } from '../src/app.js';
import { signRequest, publicIdentity } from '../src/auth.js';
export const origin = 'https://localhost';
export const token = 'test-administrator-credential-32-characters';
export async function keypair() {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const publicKey = Buffer.from(
        await crypto.subtle.exportKey('raw', pair.publicKey)
    ).toString('base64');
    return {
        ...pair,
        rawPublicKey: publicKey,
        fingerprint: (await publicIdentity(publicKey)).fingerprint
    };
}

export function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'cm-registry-'));
    const db = new Database();
    const storage = new FileStorage(directory);
    const errors = [];
    const app = createApp({
        db,
        storage,
        adminToken: token,
        allowLocalHTTP: true,
        onError: e => errors.push(e)
    });
    t.after(() => {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const fetch = async (
        path,
        { method = 'GET', body, key, headers = {}, signOptions } = {}
    ) => {
        const options = { method, headers: {} };
        if (body !== undefined) {
            const isBinary = body instanceof Uint8Array;
            options.headers['content-type'] = isBinary
                ? 'application/octet-stream'
                : 'application/json';
            options.body = isBinary ? body : JSON.stringify(body);
        }
        Object.assign(options.headers, headers);
        let request = new Request(origin + path, options);
        if (key)
            request = await signRequest(
                request,
                key.privateKey,
                key.fingerprint,
                signOptions
            );
        return app.fetch(request);
    };
    const admin = (path, body) =>
        fetch('/v1/admin/' + path, {
            method: body === undefined ? 'GET' : 'POST',
            body,
            headers: { authorization: 'Bearer ' + token }
        });
    const register = async key => {
        const response = await fetch('/v1/access-requests', {
            method: 'POST',
            body: {
                publicKey: key.rawPublicKey,
                displayName: 'Example author',
                description: 'Extensions for cards'
            },
            key
        });
        if (!response.ok) throw new Error(JSON.stringify(await response.json()));
        return response.json();
    };
    const approve = async key => {
        const request = await register(key);
        const response = await admin('access-requests/' + request.id + '/approve', {});
        if (!response.ok) throw new Error(JSON.stringify(await response.json()));
        return response.json();
    };
    return { db, storage, app, fetch, admin, register, approve, errors };
}

export function archive(id = 'demo', version = '1.0.0', type = 'game', other = {}) {
    const folders = {
        game: ['games', 'game.json'],
        template: ['templates', 'template.json'],
        cardpart: ['cardparts', 'module.json'],
        exporter: ['exporters', 'exporter.json']
    };
    const [folder, name] = folders[type];
    return zipSync({
        [`${folder}/${id}/${name}`]: new TextEncoder().encode(
            JSON.stringify({ id, version, name: 'Example', ...other })
        ),
        [`${folder}/${id}/main.js`]: new TextEncoder().encode('export default {};')
    });
}

export async function submission(
    f,
    key,
    bytes = archive(),
    extensionId = 'demo',
    version = '1.0.0',
    type = 'game',
    idempotencyKey
) {
    const response = await f.fetch('/v1/submissions', {
        method: 'POST',
        key,
        body: { extensionId, version, type, sha256: sha256(bytes), size: bytes.length },
        signOptions: { idempotencyKey }
    });
    return { response, details: await response.json(), bytes };
}

export async function finalize(f, key, slot) {
    let r = await f.fetch(slot.details.uploadPath, {
        method: 'PUT',
        key,
        body: slot.bytes
    });
    if (!r.ok) throw new Error(JSON.stringify(await r.json()));
    return f.fetch(`/v1/submissions/${slot.details.id}/finalize`, {
        method: 'POST',
        key,
        body: {}
    });
}
