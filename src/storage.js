import {
    mkdirSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
    linkSync,
    openSync,
    closeSync,
    fsyncSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ImmutableArtifact, InvalidStorageKey } from './errors.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Neither namespace is served by a static file server. Downloads pass through the API.
export class FileStorage {
    constructor(root) {
        this.root = resolve(root);
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
    }

    path(key) {
        if (!/^(staging|releases)\/[a-zA-Z0-9-]+$/.test(key))
            throw new InvalidStorageKey();
        return join(this.root, key.replace('/', '-'));
    }

    get(key) {
        try {
            return readFileSync(this.path(key));
        } catch (e) {
            if (e.code === 'ENOENT') return null;
            throw e;
        }
    }

    put(key, bytes) {
        const destination = this.path(key);
        const temporary = join(this.root, `.upload-${randomUUID()}`);
        try {
            writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
            const fd = openSync(temporary, 'r');
            try {
                fsyncSync(fd);
            } finally {
                closeSync(fd);
            }
            try {
                linkSync(temporary, destination);
            } catch (e) {
                if (e.code !== 'EEXIST') throw e;
                if (sha256(this.get(key)) !== sha256(bytes))
                    throw new ImmutableArtifact();
            }
            const directory = openSync(this.root, 'r');
            try {
                fsyncSync(directory);
            } finally {
                closeSync(directory);
            }
        } finally {
            try {
                unlinkSync(temporary);
            } catch (e) {}
        }
    }

    delete(key) {
        try {
            unlinkSync(this.path(key));
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
    }
}
