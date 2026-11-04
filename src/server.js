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
const server = http.createServer(async (incoming, outgoing) => {
    try {
        // Fixed trusted authority, never proxy headers. Sign for the printed origin.
        const request = new Request(
            `http://127.0.0.1:${server.address().port}${incoming.url}`,
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
server.listen(port, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Registry: ${origin}; administration: ${origin}/admin`);
});

for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
        server.close(() => {
            db.close();
            process.exit(0);
        })
    );
