import * as auditEvents from '../src/database/auditEvents.js';
import { getDatabase, transaction } from '../src/database/connection.js';
import * as rateLimits from '../src/database/rateLimits.js';
import * as submissionQueries from '../src/database/submissions.js';
import * as usedNonces from '../src/database/usedNonces.js';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeDatabase } from '../src/db.js';
import { FileStorage } from '../src/storage.js';

function backup() {
    const target = process.argv[3];
    if (!target)
        throw new Error('Usage: npm run backup -- /absolute/path/to/new-backup.sqlite');
    getDatabase().backup(resolve(target));
    chmodSync(resolve(target), 0o600);
    console.log(
        'Database backup complete. Copy the artifacts directory separately '
            + 'while the server is stopped.'
    );
}

function expireUploads() {
    const expired = submissionQueries.listExpiredUploads(Date.now());
    submissionQueries.expireUploads({ before: Date.now() });
    usedNonces.pruneExpired({ before: Math.floor(Date.now() / 1000) - 5 });
    rateLimits.pruneBefore({ window: Math.floor(Date.now() / 60000) - 2 });
    if (expired.length)
        auditEvents.record('maintenance', 'uploads.expire', 'submissions', {
            count: expired.length
        });
    return submissionQueries.listDiscarded();
}

function cleanup(directory) {
    const storage = new FileStorage(resolve(directory, 'artifacts'));
    const discarded = transaction(expireUploads);
    for (const submission of discarded) storage.delete(`staging/${submission.id}`);
    console.log(
        `Cleaned ${discarded.length} staging objects; records and releases retained.`
    );
}

const commands = {
    backup,
    cleanup,
    migrate: () => console.log('Schema is current.')
};
const directory = resolve(process.env.REGISTRY_DATA ?? 'var');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = initializeDatabase(resolve(directory, 'registry.sqlite'));
try {
    const name = process.argv[2] ?? 'migrate';
    const command = Object.hasOwn(commands, name) ? commands[name] : null;
    if (!command) throw new Error('Unknown maintenance command');
    command(directory);
} finally {
    db.close();
}
