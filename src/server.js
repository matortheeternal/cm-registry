import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeDatabase } from './db.js';
import { FileStorage } from './storage.js';
import { createApp } from './app.js';

const directory = resolve(process.env.REGISTRY_DATA ?? 'var');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = initializeDatabase(resolve(directory, 'registry.sqlite'));
const app = createApp({
    storage: new FileStorage(resolve(directory, 'artifacts')),
    adminToken: process.env.REGISTRY_ADMIN_TOKEN,
    allowLocalHTTP: true,
    onError: event => console.error(JSON.stringify(event))
});
const port = Number(process.env.PORT ?? 8787);
const publicOrigin = process.env.REGISTRY_PUBLIC_ORIGIN;
if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin
    || new URL(publicOrigin).protocol !== 'https:'))
    throw new Error('REGISTRY_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');

function createServer({ origin, privateAdmin = false }) {
    const server = http.createServer(async (incoming, outgoing) => {
        try {
            const path = incoming.url.split('?')[0];
            if (!incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
                outgoing.writeHead(400);
                outgoing.end();
                return;
            }
            // Public requests cannot reach the local-only admin adapter, even with a token.
            if (publicOrigin && !privateAdmin && /^\/(admin|v1\/admin)(\/|$)/.test(path)) {
                outgoing.writeHead(404);
                outgoing.end();
                return;
            }
            // Explicit trusted authority, never Host or forwarded headers.
            const request = new Request(
                `${origin ?? `http://127.0.0.1:${server.address().port}`}${incoming.url}`,
                {
                    method: incoming.method,
                    headers: incoming.headers,
                    ...(!['GET', 'HEAD'].includes(incoming.method)
                        ? { body: incoming, duplex: 'half' }
                        : {})
                }
            );
            const response = await app.fetch(request);
            outgoing.writeHead(response.status, Object.fromEntries(response.headers));
            if (incoming.method === 'HEAD') {
                outgoing.end();
                return;
            }
            outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
            outgoing.writeHead(500, { 'Content-Type': 'application/json' });
            outgoing.end('{"error":{"code":"internal","message":"Request failed"}}');
        }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    return server;
}

const server = createServer({ origin: publicOrigin });
const servers = [server];
server.listen(port, publicOrigin ? '0.0.0.0' : '127.0.0.1', () => {
    const origin = publicOrigin ?? `http://127.0.0.1:${server.address().port}`;
    console.log(`Listening on port ${server.address().port}`);
    console.log(`Registry: ${origin}${publicOrigin ? '' : `; administration: ${origin}/admin`}`);
});

if (publicOrigin) {
    const adminPort = Number(process.env.REGISTRY_ADMIN_PORT ?? 8788);
    // No Fly public service is configured for this port. Access through fly proxy.
    const admin = createServer({ privateAdmin: true });
    servers.push(admin);
    admin.listen(adminPort, '::', () =>
        console.log(`Private administration: http://127.0.0.1:${admin.address().port}/admin`));
}

for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
        await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
        db.close();
        process.exit(0);
    });
